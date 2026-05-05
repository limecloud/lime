# AI 图层化设计实现执行计划

> 状态：P3G 图层任务刷新与主流图片模型族能力约束已接入，定向校验通过；GUI smoke 已尝试但被知识库 smoke 阻塞
> 创建时间：2026-05-05
> 路线图来源：`docs/roadmap/ai-layered-design/README.md`
> 当前目标：先建立 `LayeredDesignDocument` 的最小 current 协议和纯函数不变量，再逐步接入原生分层生成、Canvas 编辑、单层重生成和导出。

## 主目标

把 Lime 的 AI 图片生成从“返回一张扁平 PNG”升级为“生成、保存、重新打开并继续编辑的设计工程”：

```text
用户目标 / @海报 / @配图
  -> Layer Planner
  -> Asset Generator
  -> LayeredDesignDocument
  -> Design Canvas Editor
  -> Exporter / Artifact / Evidence
```

固定事实源：

**AI 图层化设计的 current 事实源是 `LayeredDesignDocument`；Canvas Editor、导出、单层重生成和后续拆层都必须读写这份文档。现有 `DocumentCanvas` / `ImageTaskViewer` / `TeamWorkspaceCanvas` 只作为 UI 和交互基础参考，不反向定义设计协议。**

## 已完成阶段范围

已完成：

1. 新增执行计划并回挂 `docs/exec-plans/README.md`。
2. 新增 `src/lib/layered-design/` 的 P1 最小协议。
3. 用纯函数保证图层排序、默认值归一化、单层资产替换和 transform 更新不变量。
4. 补定向单测，证明预览 PNG 只是导出投影，不是设计事实源。
5. 新增 `DesignCanvas` 最小可见 UI，并把 `canvas:design` Artifact 打开链路接入 Workspace Canvas。
6. 新增本地 Layer Planner seed：从 prompt 生成可编辑图层计划，不调用图片模型。
7. 新增 `LayeredDesignDocument -> canvas:design Artifact` bridge，让 prompt seed 能进入当前 Artifact / Canvas 主链。
8. 新增 provider-agnostic 资产生成 seam：从图片图层创建生成请求，并把 provider 输出写回目标图层。
9. 新增 `LayeredDesignAssetGenerationRequest -> create_image_generation_task_artifact` adapter，复用现有图片任务主链。
10. 在 `DesignCanvas` 增加“生成全部图片层 / 重生成当前层”入口，提交任务后回写 `LayeredDesignDocument.editHistory`。
11. 从 `LayeredDesignDocument.editHistory` 恢复已提交图片任务，并通过现有 `get_media_task_artifact` 刷新成功结果回写目标图层。
12. 借鉴 Codex `imagegen` 的模型能力约束与透明图层 chroma-key 后处理策略，扩展为主流图片模型族 registry 并沉到 `runtimeContract.layered_design`，不新增 Python CLI 旁路。

仍未做：

1. 不新增 Tauri 命令、Bridge、mock 或 provider adapter。
2. 不直接调用 `gpt-image-2` / Gemini / Flux；当前只规范 request contract 与现有 media task artifact 写回。
3. 不引入 Fabric 运行时。
4. 不实现 PSD、mask、inpaint、OCR 或扁平图拆层。
5. 不宣称 GUI 完整可交付；还需要补 `verify:gui-smoke`。

## 阶段计划

### P0：文档与边界

状态：已完成 proposal 文档，进入 implementation 跟踪。

产物：

1. `docs/research/ai-layered-design/`
2. `docs/roadmap/ai-layered-design/`
3. `docs/roadmap/creaoai/` 与 AI 图层化设计边界说明

完成标准：

1. 文档说明为什么不先训练模型。
2. 文档固定 `LayeredDesignDocument` 是 current 事实源。
3. 文档说明 Lovart 类“可调整图层”来自工程编排，不是单个生图模型。

### P1：LayeredDesignDocument 最小协议

状态：已完成 P1 第一刀。

产物：

1. `src/lib/layered-design/types.ts`
2. `src/lib/layered-design/document.ts`
3. `src/lib/layered-design/index.ts`
4. `src/lib/layered-design/document.test.ts`

完成标准：

1. 创建文档时按 `zIndex` 稳定排序。
2. 普通文案默认是 `TextLayer`，不是烘焙图片。
3. 单层替换 asset 不改变 layer id、transform、zIndex、visible、locked。
4. normalize 能填充 `visible`、`locked`、`opacity`、`rotation` 等缺省值。
5. preview 只作为导出投影，不进入 `layers[]`。

### P2：Design Canvas Editor

状态：已完成最小可见 UI 与 Artifact 接入口。

计划：

1. 在现有 Workspace / CanvasWorkbench 壳层下新增 `DesignCanvas`。
2. 第一版用 DOM/CSS absolute layers 支持选择、拖动、缩放、隐藏、锁定和 zIndex。
3. 图层栏和属性栏只读写 `LayeredDesignDocument`。
4. Fabric 只作为后续更复杂选择框、旋转和导出的候选实现，不作为首刀依赖。
5. 旧 `canvas:poster / canvas:music / canvas:novel / canvas:script` 不再归一到现役画布；需要图层化图片设计时必须使用 `canvas:design`。

### P3：原生分层生成与单层重生成

状态：P3G 已完成本地 seed、Artifact bridge、provider-agnostic 资产生成 seam、现有 image task artifact API adapter、`DesignCanvas` 生成入口、任务结果刷新写回，以及 OpenAI / Gemini Imagen / Flux / Stable Diffusion / Ideogram / Recraft / Seedream / CogView / Midjourney 等主流模型族能力 request contract；GUI smoke 未完成。

计划：

1. Layer Planner 输出 5-8 个可编辑层。
2. Prompt seed 生成 `canvas:design` Artifact，直接进入 `DesignCanvas`。
3. Asset Generator 通过 provider capability seam 调用图片模型。
4. 每个 ImageLayer 绑定 asset、prompt、provider、modelId。
5. 单层重生成只替换该层 asset，并写入 edit history。

### P4：扁平图拆层与专业导出

状态：未开始。

计划：

1. 上传扁平图后识别主体、文字、Logo、背景候选层。
2. 通过 mask / matting / clean plate 建立可编辑文档。
3. 先稳定导出 PNG + JSON + assets，再试点 PSD-like 投影。

## 已完成的不变量

当前已证明：

1. `LayeredDesignDocument` 类型是唯一 current 设计事实源。
2. `GeneratedDesignAsset` 只是资产记录，只有被 layer 引用才进入图层栏语义。
3. `DesignPreviewProjection` 只是当前导出预览的投影，编辑会把它标记为 stale。
4. 所有编辑函数保持不可变更新，避免 Canvas 状态绕过文档。
5. Prompt seed 里的普通文案保持 `TextLayer`，不被烘焙成图片。
6. Prompt seed 里的图片资产只是 `plannedOnly` 占位，不隐式调用 provider。
7. `canvas:design` 是图层化设计唯一 current Artifact 类型；旧 `canvas:poster` 不再参与归一。
8. 资产生成 seam 只选择图片 / effect 图层，跳过 `TextLayer`，并允许单层重生成重新进入 provider seam。
9. 图层生成任务复用现有 `create_image_generation_task_artifact`，通过 `slotId / targetOutputId / targetOutputRefId / anchorHint` 保留 document/layer/asset 关联，不新增旧 poster 协议。
10. Canvas UI 提交任务后必须回写 `LayeredDesignDocument.editHistory`；如果任务输出已经包含图片结果，立即写回目标图片层 asset，文字层保持可编辑。
11. `asset_generation_requested` 必须记录 `taskId / taskPath / taskStatus`，后续打开同一设计工程时可恢复等待写回的图片任务。
12. 主流图片模型族必须通过统一 capability registry 判断尺寸策略、透明策略、编辑/mask/reference 能力；未知模型走 `generic + provider_passthrough`，不阻塞任务创建。
13. `gpt-image-2 / gpt-images-2` 图层任务必须归一到 16 倍数尺寸与合法像素范围；透明图层只记录 `chroma_key_postprocess` 策略，不把 Python CLI 变成 Lime current 主链。

## 验证策略

当前改动横跨 TypeScript 协议、Artifact adapter 和 Workspace Canvas UI。未触及 Tauri 命令、Bridge、mock、配置或版本。

最低校验：

```bash
npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/planner.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/generation.test.ts" "src/lib/layered-design/imageModelCapabilities.test.ts" "src/lib/layered-design/imageTasks.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/artifact/canvasAdapterUtils.test.ts" "src/components/artifact/ArtifactRenderer.ui.test.tsx"
npm exec -- eslint "src/lib/layered-design/**/*.ts" "src/components/artifact/canvasAdapterUtils.ts" "src/components/artifact/canvasAdapterUtils.test.ts" --max-warnings 0
npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit
```

GUI 主路径可交付前还要追加：

```bash
npm run verify:local
npm run verify:gui-smoke
```

后续进入 Tauri 命令 / provider / mock 时再追加：

```bash
npm run test:contracts
npm run governance:legacy-report
```

## 进度日志

### 2026-05-05

- 已创建本执行计划，承接 `docs/roadmap/ai-layered-design/`。
- 当前阶段固定为 P1 第一刀：先落 `LayeredDesignDocument` 协议和纯函数测试。
- 本轮不接 GUI、provider、Tauri 命令或 Fabric，避免在事实源未稳定前扩展平行实现。
- 已新增 `src/lib/layered-design/types.ts`、`src/lib/layered-design/document.ts`、`src/lib/layered-design/index.ts` 与 `src/lib/layered-design/document.test.ts`。
- 已实现 `LayeredDesignDocument`、`DesignCanvas`、`DesignLayer`、`GeneratedDesignAsset`、`LayerEditRecord`、创建 / normalize / 排序 / 单层资产替换 / transform 更新等 P1 最小协议。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/document.test.ts"`，5 个定向测试覆盖 zIndex 排序、TextLayer、单层替换不变量、默认值归一化和 preview 投影语义。
- 已通过 `npm exec -- eslint "src/lib/layered-design/**/*.ts" --max-warnings 0` 与定向 `tsc`，确认本轮新增协议文件静态检查通过。
- 已执行 `npm run typecheck`，当前失败来自未跟随本轮修改的未跟踪文件 `src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts`：测试构造的 `output_schema_runtime` 缺少 `source` 与 `strategy` 字段；本轮未修改该区域，未纳入本阶段修复范围。

### 2026-05-05 P2 最小 Canvas UI

- 已新增 `src/components/workspace/design/DesignCanvas.tsx` 与 `src/components/workspace/design/types.ts`，提供图层栏、画布预览、属性栏、选择、移动、显隐、锁定、zIndex 调整和 zoom 控制。
- 已把 `CanvasStateUnion` 扩展为 `document / video / design`，并在 `CanvasFactory` 与 `workbenchCanvas` current 网关接入 `DesignCanvas`。
- 已新增 `canvas:design` Artifact 类型和 `.json` 默认扩展名；Artifact adapter 可从 `LayeredDesignDocument` JSON 创建 design canvas state，并把 design canvas state 序列化回同一文档 JSON。
- 已清理旧 Canvas 类型别名：`canvas:poster / canvas:music / canvas:novel / canvas:script` 不再归一到 `canvas:document / canvas:video`，避免旧专用主题继续伪装成新设计工程主线。
- 已同步 `src/components/artifact/README.md`，明确旧 Canvas 别名不再是 compat 主链；图层化图片设计必须走 `canvas:design + LayeredDesignDocument`。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx`、`src/components/artifact/canvasAdapterUtils.test.ts` 与 `canvasUtils` 回归，锁定 UI 操作必须回写文档而不是只改 DOM。
- 已修正 `ArtifactRenderer` 的 Canvas 分发顺序：Canvas 类型先委托给 `CanvasAdapter`，不再要求先注册轻量 renderer；`canvas:design` 因此能从 Artifact 直接打开 `DesignCanvas`。
- 已补 `src/components/artifact/ArtifactRenderer.ui.test.tsx` 回归，覆盖 `canvas:design` 从 Artifact 直接渲染到图层设计画布。
- 已同步 `ArtifactToolbar` MIME：`canvas:design` 导出内容按 `application/json` 处理。
- 已补 `src/components/agent/chat/workspace/generalWorkbenchHelpers.test.ts`，覆盖 design canvas 的空态判断和 `LayeredDesignDocument` JSON 同步。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/artifact/canvasAdapterUtils.test.ts" "src/components/workspace/canvas/canvasUtils.test.ts"`。
- 已通过 `npm exec -- vitest run "src/lib/artifact/parser.test.ts" "src/lib/artifact/registry.test.ts" "src/components/artifact/ArtifactRenderer.test.ts" "src/components/artifact/ArtifactToolbar.test.ts"`。
- 已通过 `npm exec -- vitest run "src/components/artifact/ArtifactRenderer.ui.test.tsx" "src/components/artifact/canvasAdapterUtils.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx"`。
- 已通过 `npm exec -- vitest run "src/components/artifact/ArtifactToolbar.test.ts" "src/components/agent/chat/workspace/generalWorkbenchHelpers.test.ts" "src/components/artifact/ArtifactRenderer.ui.test.tsx"`。
- 已通过 `npm exec -- eslint "src/lib/layered-design/**/*.ts" "src/components/workspace/design/**/*.{ts,tsx}" "src/components/workspace/canvas/canvasUtils.ts" "src/components/workspace/canvas/canvasUtils.test.ts" "src/components/workspace/canvas/CanvasFactory.tsx" "src/components/artifact/canvasAdapterUtils.ts" "src/components/artifact/canvasAdapterUtils.test.ts" "src/lib/artifact/types.ts" "src/lib/artifact/parser.ts" "src/components/artifact/ArtifactRenderer.test.ts" "src/components/artifact/ArtifactToolbar.test.ts" "src/components/agent/chat/workspace/generalWorkbenchHelpers.ts" --max-warnings 0`。
- 已通过增量 ESLint：`npm exec -- eslint "src/components/artifact/ArtifactToolbar.tsx" "src/components/artifact/ArtifactToolbar.test.ts" "src/components/agent/chat/workspace/generalWorkbenchHelpers.ts" "src/components/agent/chat/workspace/generalWorkbenchHelpers.test.ts" "src/components/artifact/ArtifactRenderer.tsx" "src/components/artifact/ArtifactRenderer.ui.test.tsx" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`，范围包含 `src/vite-env.d.ts`、layered-design、DesignCanvas、CanvasFactory、CanvasAdapter、ArtifactRenderer、artifact 类型/解析和 Workbench 同步 helper。
- 已通过 `git diff --check` 相关文件检查。
- 已尝试 `npm run typecheck`，120 秒内未完成并被中止；本轮定向测试和 ESLint 已覆盖新增边界，完整 typecheck 需要等当前工作区并发校验任务收口后补跑。

### 2026-05-05 P3A 本地 Layer Planner seed 与 Artifact bridge

- 已新增 `src/lib/layered-design/planner.test.ts`，锁定 prompt seed 会生成背景、主体、氛围特效、主标题、副标题、CTA 底和 CTA 文案等 7 个可编辑层。
- 已确认 prompt seed 中普通文案保持 `TextLayer`，图片资产仅为 `plannedOnly` 占位，`src` 为空且不写 `provider / modelId`，不会假装已经调用 `gpt-image-2`、Gemini 或其他模型。
- 已新增 `src/lib/layered-design/artifact.ts`，提供 `createLayeredDesignArtifact` 与 `createLayeredDesignArtifactFromPrompt`，统一生成 `canvas:design` Artifact。
- 已通过 `createLayeredDesignArtifactFromPrompt -> createCanvasStateFromArtifact -> DesignCanvasState` 回归，证明 prompt seed 能进入当前 Artifact / Canvas 主链。
- 已从 `src/lib/layered-design/index.ts` 导出 planner 与 artifact bridge，后续主链入口不需要绕到旧 poster / image viewer。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/planner.test.ts" "src/lib/layered-design/artifact.test.ts" "src/components/artifact/canvasAdapterUtils.test.ts"`，共 13 个定向测试。
- 已通过 `npm exec -- eslint "src/lib/layered-design/**/*.ts" "src/components/artifact/canvasAdapterUtils.ts" "src/components/artifact/canvasAdapterUtils.test.ts" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 当前仍未跑 `npm run verify:gui-smoke`，因此 GUI 主路径还不能宣称完整可交付。

### 2026-05-05 P3B provider-agnostic 资产生成 seam

- 已新增 `src/lib/layered-design/generation.ts`，提供 `createLayeredDesignAssetGenerationPlan`、`createSingleLayerAssetGenerationRequest` 与 `applyLayeredDesignGeneratedAsset`。
- 资产生成计划只选择 `ImageLayer / EffectLayer`，跳过 `TextLayer`，确保普通文案继续留在可编辑图层而不是被送进生图模型。
- 默认生成计划只请求空 `src` 或 `plannedOnly` 资产；单层重生成请求允许已生成资产再次进入 provider seam。
- 写入 provider 输出时只替换目标图片层的 asset，并把该层标记为 `source: "generated"`；其他图层和文字层保持不变。
- 该 seam 不调用 `gpt-image-2`、Gemini 或本地模型，只定义 current 文档如何对接后续 provider adapter。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/planner.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/generation.test.ts" "src/components/artifact/canvasAdapterUtils.test.ts"`，共 17 个定向测试。
- 已通过 `npm exec -- eslint "src/lib/layered-design/**/*.ts" "src/components/artifact/canvasAdapterUtils.ts" "src/components/artifact/canvasAdapterUtils.test.ts" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 下一刀应接真实 provider adapter 或 UI 单层重生成入口，不能回到旧 `poster_generate / ImageTaskViewer`。

### 2026-05-05 P3C image task adapter

- 已新增 `src/lib/layered-design/imageTasks.ts`，把 `LayeredDesignAssetGenerationRequest` 映射到现有 `createImageGenerationTaskArtifact` 前端 API。
- 映射后的图片任务使用 `entrySource: "layered_design_canvas"`、`modalityContractKey: "image_generation"`、`routingSlot: "image_generation_model"`，不新增 Tauri 命令、不新增 mock、不回到旧 poster 协议。
- 图层关联通过现有字段持久化：`slotId=layerId`、`targetOutputId=assetId`、`targetOutputRefId=generationRequest.id`、`anchorHint=layered-design:<documentId>:<layerId>`。
- 已新增 `createGeneratedDesignAssetFromImageTaskOutput`，能从成功的 image task result 创建 `GeneratedDesignAsset`，并保留 `provider / model / taskId / taskPath / layerId / documentId`。
- 已新增 `applyLayeredDesignImageTaskOutput`，可把成功任务输出写回目标图层；文字层仍保持 `TextLayer` 可编辑。
- 已补 `src/lib/layered-design/imageTasks.test.ts`，覆盖请求映射、批量提交、任务输出转 asset、任务输出写回文档，并断言不出现 `poster_generate / canvas:poster`。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/planner.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/generation.test.ts" "src/lib/layered-design/imageTasks.test.ts" "src/components/artifact/canvasAdapterUtils.test.ts"`，共 21 个定向测试。
- 已通过 `npm exec -- eslint "src/lib/layered-design/**/*.ts" "src/components/artifact/canvasAdapterUtils.ts" "src/components/artifact/canvasAdapterUtils.test.ts" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 当前仍未跑 `npm run test:contracts` 与 `npm run verify:gui-smoke`；本轮没有新增命令面，但下一轮接 UI 或真实轮询后必须补 GUI 主路径验证。

### 2026-05-05 P3D DesignCanvas 图层生成入口

- 已在 `src/components/workspace/design/DesignCanvas.tsx` 增加“生成全部图片层”和“重生成当前层”入口，页面类型属于宽工作台，按钮沿用深色主按钮 + 白底描边次按钮层级。
- `DesignCanvas` 生成入口只调用 `createLayeredDesignImageTaskArtifacts` current adapter；没有接 `poster_generate`、`canvas:poster` 或 `ImageTaskViewer`。
- 提交任务后通过 `recordLayeredDesignImageTaskSubmissions` 回写 `LayeredDesignDocument.editHistory`，保证 UI 操作不只停在 DOM 状态。
- 如果任务输出已经包含图片结果，`DesignCanvas` 会立刻用 `applyLayeredDesignImageTaskOutput` 写回目标图片层 asset；文字层继续保持 `TextLayer`。
- `CanvasFactory` 已向 design canvas 透传 `projectRootPath / projectId / contentId`，`useWorkspaceCanvasSceneRuntime` 使用当前 workspace root 作为图片任务根目录。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx` 回归，覆盖全部生成、单层重生成、任务请求字段、edit history 回写、任务结果写回图层和旧 poster 文本不回流。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/planner.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/generation.test.ts" "src/lib/layered-design/imageTasks.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/artifact/canvasAdapterUtils.test.ts" "src/components/artifact/ArtifactRenderer.ui.test.tsx"`，共 34 个定向测试。
- 已通过 `npm exec -- eslint "src/lib/layered-design/**/*.ts" "src/components/workspace/design/**/*.{ts,tsx}" "src/components/workspace/canvas/CanvasFactory.tsx" "src/components/agent/chat/workspace/useWorkspaceCanvasSceneRuntime.tsx" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 当前仍未跑 `npm run verify:gui-smoke`；下一刀应补任务轮询 / 结果自动写回后跑 GUI 主路径验证。

### 2026-05-05 P3E 图层任务恢复与刷新写回

- 已扩展 `LayerEditRecord`，让 `asset_generation_requested` 记录 `taskId / taskPath / taskStatus`，避免任务提交后只能依赖当前 React 内存状态。
- 已新增 `listPendingLayeredDesignImageTasks`，从 `LayeredDesignDocument.editHistory` 恢复仍等待写回的图片任务；如果同一图层已有后续 `asset_replaced`，旧任务会被视为已关闭。
- 已新增 `refreshLayeredDesignImageTaskResults`，复用现有 `getMediaTaskArtifact` / `get_media_task_artifact` 刷新图片任务结果，成功时只替换目标图片层 asset。
- 已在 `DesignCanvas` 增加“刷新生成结果”入口；页面仍属于宽工作台，主生成按钮与刷新按钮保持深色主按钮 + 白底描边次按钮层级，不引入新的视觉体系。
- 已补 `src/lib/layered-design/imageTasks.test.ts` 与 `src/components/workspace/design/DesignCanvas.test.tsx` 回归，覆盖 pending 任务恢复、刷新调用、成功结果写回和文字层保持可编辑。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/imageTasks.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx"`，共 13 个定向测试。
- 当前仍未跑 `npm run verify:gui-smoke`，GUI 主路径还不能宣称完整可交付。

### 2026-05-05 P3F 借鉴 Codex imagegen 的模型能力约束

- 已只读分析 `/Users/coso/Documents/dev/rust/codex/codex-rs/skills/src/assets/samples/imagegen/`，确认适合借鉴的是模型能力约束、透明图层后处理策略和多资产生成纪律，不适合直接引入 Python CLI 旁路。
- 已新增 `src/lib/layered-design/imageModelCapabilities.ts`，把 `gpt-image-2 / gpt-images-2` 的 16 倍数、最大边、像素范围、长短边比例和透明背景限制沉到纯函数。
- `createLayeredDesignImageTaskRequest` 现在会在指定 `gpt-image-2 / gpt-images-2` 时归一任务尺寸，并把原始尺寸、任务尺寸、alpha 策略写入 `runtimeContract.layered_design`。
- 透明图层当前只记录 `chroma_key_postprocess` 策略和默认 key color，不直接把 Codex `scripts/image_gen.py` 或 chroma-key prompt 接成产品主链；后续应在 media task worker 内做本地 post-process。
- 已补 `src/lib/layered-design/imageModelCapabilities.test.ts` 与 `src/lib/layered-design/imageTasks.test.ts` 回归，证明 request contract 仍是 `image_generation`，没有新增旧 `poster_generate / canvas:poster` 协议。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/imageModelCapabilities.test.ts" "src/lib/layered-design/imageTasks.test.ts"`，共 11 个定向测试。

### 2026-05-05 P3G 主流图片模型族 capability registry

- 已把上一刀的 `gpt-image-2` 单点判断扩展为主流模型族 registry：`openai-gpt-image-2`、`openai-gpt-image`、`openai-dalle`、`google-imagen`、`flux`、`stable-diffusion`、`ideogram`、`recraft`、`seedream`、`cogview`、`midjourney` 与 `generic`。
- `LayeredDesignImageModelCapability` 现在记录 `sizePolicy`、`allowedSizes`、`supportsNativeTransparency`、`supportsImageEdit`、`supportsMask`、`supportsReferenceImages` 等能力；未知模型走 `generic + provider_passthrough`，不阻塞现有 provider routing。
- 尺寸策略已收敛为四类：`flexible_pixels`、`allowed_sizes`、`multiple_pixels`、`provider_passthrough`；OpenAI legacy / DALL-E 会选最接近允许尺寸，Stable Diffusion 会按 64 倍数归一，Flux 会按最大像素做保守缩放。
- `createLayeredDesignImageTaskRequest` 继续只复用现有 `create_image_generation_task_artifact`，但会把模型族、provider、size policy、透明策略和编辑/mask/reference 能力写入 `runtimeContract.layered_design`。
- 已补 `src/lib/layered-design/imageModelCapabilities.test.ts`，覆盖 `gpt-image-1.5`、`flux-pro`、`stable-diffusion-xl`、`seedream-4.0` 等非 gpt-image-2 模型族，避免当前主线绑定单一模型。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/imageModelCapabilities.test.ts" "src/lib/layered-design/imageTasks.test.ts"`，共 12 个定向测试。
- 已修正 `LayeredDesignImageRuntimeContract` 类型，让它可直接写入现有图片任务 `runtimeContract: Record<string, unknown>`，不新增任务协议或桥接命令。
- 已通过 P3G 汇总回归：`npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/planner.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/generation.test.ts" "src/lib/layered-design/imageModelCapabilities.test.ts" "src/lib/layered-design/imageTasks.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/artifact/canvasAdapterUtils.test.ts" "src/components/artifact/ArtifactRenderer.ui.test.tsx"`，共 43 个定向测试。
- 已通过 P3G 定向 ESLint：`npm exec -- eslint "src/lib/layered-design/**/*.ts" "src/components/workspace/design/**/*.{ts,tsx}" "src/components/workspace/canvas/CanvasFactory.tsx" "src/components/agent/chat/workspace/useWorkspaceCanvasSceneRuntime.tsx" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 已尝试 `npm run verify:gui-smoke`；workspace-ready、browser-runtime、site-adapters、agent-service-skill-entry、agent-runtime-tool-surface 与 agent-runtime-tool-surface-page 已通过，但 `smoke:knowledge-gui` 在打开知识库入口时失败：当前页面按钮暴露为“项目资料 / 打开项目资料 / 打开资料中枢”，没有命中 smoke 期望的 `ariaLabel="知识库"`。该阻塞不来自 AI 图层化设计代码，但在修复 smoke 入口前，整条 GUI smoke 仍不能作为通过结论。
