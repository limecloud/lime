# AI 图层化设计实现执行计划

> 状态：P4I 原生工程目录远程资产持久化缓存已完成，P4J 扁平图拆层协议首刀已完成，P4K 扁平图 draft `canvas:design` artifact bridge 已完成，P4L 上传扁平图本地 draft adapter 已完成，P4M DesignCanvas 候选层切换首刀已完成，P4N 上传扁平图本地 heuristic seed 首刀已完成；上传图片现在已能直接归一为 extraction draft，并生成可切换的本地裁片候选层进入 current `DesignCanvas`；定向单测、ESLint、定向 TypeScript 与 GUI smoke 已通过
> 创建时间：2026-05-05
> 路线图来源：`docs/roadmap/ai-layered-design/README.md`
> 当前目标：围绕 `LayeredDesignDocument` current 事实源完成生成、编辑、任务回写、工程目录保存、恢复、PSD-like 专业层栈投影，以及扁平图拆层 draft/候选层切换与本地 heuristic seed 首刀；下一步进入拆层确认页接线、真实 analyzer adapter，或真 PSD writer、复杂 matting / mask refine。

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
13. 新增 `LayeredDesignDocument` 导出投影：`design.json`、`export-manifest.json`、`preview.svg`、`preview.png` 与内嵌 data URL assets 下载入口。
14. 新增 DEV-only `/design-canvas-smoke` 页面与 `smoke:design-canvas`，真实页面已验证 `canvas:design -> DesignCanvas -> 图层选择/移动/显隐` 主路径。
15. 完整 `npm run verify:gui-smoke` 已通过，证明默认 GUI 壳、DevBridge、workspace、browser runtime、runtime tool surface、knowledge GUI 与 design canvas smoke 在同一轮可跑通。
16. 新增无依赖 ZIP 工程包导出：单个 `.layered-design.zip` 包含 `design.json`、`export-manifest.json`、`preview.svg`、`preview.png` 与 `assets/` 内嵌资产。
17. 修复图片任务 artifact 对自定义 `runtime_contract.layered_design` 的透传，并让 media task worker 消费 `chroma_key_postprocess`：生成提示词追加 chroma-key 背景约束，结果图与最终 task result 写入 `postprocess` seam，前端写回资产时保留该状态。
18. 在 media task worker 内实现 data URL PNG 的 `chroma-key -> alpha` 像素级后处理：支持 `data:image/png;base64` 输出透明 PNG，远程 URL 保留原图并标记 `skipped_unsupported_source`，不让后处理失败中断图片任务。
19. 在 media task worker 内补齐 http/https 远程 URL PNG 下载后处理：provider 返回远程图片时可受控下载、抠绿、回写透明 PNG data URL，并保留 `input_source: remote_url` 元数据。
20. 新增原生项目工程目录落盘：`DesignCanvas` 绑定项目根目录时通过 Tauri current 命令写入 `.lime/layered-designs/<document>.layered-design/`，包含 `design.json / export-manifest.json / preview.svg / preview.png / assets/`；未绑定项目时仍回退浏览器 ZIP 下载。
21. 新增原生项目工程目录读回：`DesignCanvas` 绑定项目根目录时可调用 `read_layered_design_project_export` 打开最近保存的 `.layered-design` 工程，读回 `design.json` 后归一为 `LayeredDesignDocument` 并继续编辑。
22. 新增 PSD-like 专业导出投影：`psd-like-manifest.json` 记录 back-to-front 图层栈、editable text、raster image、vector shape 与 group reference，随 ZIP 和原生工程目录一起导出，但明确 `compatibility.truePsd=false`。
23. 新增扁平图拆层协议首刀：`LayeredDesignDocument.extraction` 现在可记录 `source_image`、候选层、置信度、clean plate 状态，并通过纯函数把“已选候选层”同步为正式 `layers`，低置信度候选默认不进入正式图层。
24. 新增扁平图 draft Artifact bridge：`createLayeredDesignArtifactFromExtraction` 现在可把拆层 draft 直接包装成 `canvas:design` Artifact，并沿 current Canvas 打开链路进入 `DesignCanvasState`。
25. 新增上传扁平图本地 draft adapter：`createLayeredDesignFlatImageDraftDocument` / `createLayeredDesignArtifactFromFlatImage` 现在可把单张上传图片直接归一为 extraction draft，即使还没有真实 analyzer 结果，也能通过 current 主链进入 `DesignCanvas`。
26. 新增 `DesignCanvas` 扁平图入口与候选层切换首刀：工具栏可直接上传扁平图创建 draft，属性栏可切换 `extraction.candidates`，只把选中的候选层 materialize 到正式图层栈。
27. 新增上传扁平图本地 heuristic seed 首刀：上传本地图后会先生成主体 / 标题文字 / Logo / 边角碎片裁片候选，并继续通过 `LayeredDesignDocument.extraction` 与 current `DesignCanvas` 进入编辑；未接 OCR / matting / clean plate 真执行前，不新增第二套确认页或拆层协议。

仍未做：

1. 不新增 provider adapter、旧 poster 命令或平行主链；P4F/P4G 只新增 current 工程目录保存/读取命令。
2. 不直接调用 `gpt-image-2` / Gemini / Flux；当前只规范 request contract 与现有 media task artifact 写回。
3. 不引入 Fabric 运行时。
4. 不实现真 PSD writer、PSD 文件打开验证、mask、inpaint、OCR 或拆层模型执行；当前只完成扁平图拆层协议首刀、候选层 materialize 纯函数和本地 heuristic 裁片 seed。
5. 不宣称原生工程目录落盘、PSD-like manifest 或 `LayeredDesignDocument.extraction` 已经等同于真 PSD、mask、inpaint、OCR 或完整扁平图拆层产品流；这些仍在后续 P4/P5。
6. 不宣称已完成复杂 matting、mask refine、文字/Logo 自动拆层、拆层确认页接线或 provider 级 clean plate 生成；当前只是把后续执行结果所需的 current 事实源协议、本地 heuristic 候选层与 current Canvas 接线先落稳。

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

状态：P3G 已完成本地 seed、Artifact bridge、provider-agnostic 资产生成 seam、现有 image task artifact API adapter、`DesignCanvas` 生成入口、任务结果刷新写回，以及 OpenAI / Gemini Imagen / Flux / Stable Diffusion / Ideogram / Recraft / Seedream / CogView / Midjourney 等主流模型族能力 request contract；P4A 收口时已补完整 GUI smoke。

计划：

1. Layer Planner 输出 5-8 个可编辑层。
2. Prompt seed 生成 `canvas:design` Artifact，直接进入 `DesignCanvas`。
3. Asset Generator 通过 provider capability seam 调用图片模型。
4. 每个 ImageLayer 绑定 asset、prompt、provider、modelId。
5. 单层重生成只替换该层 asset，并写入 edit history。

### P4：扁平图拆层与专业导出

状态：P4A 设计工程导出首刀已完成，P4B 浏览器 ZIP 工程包已完成，P4C media task worker 后处理 seam 已完成，P4D data URL PNG 像素级 chroma-key 后处理已完成，P4E http/https 远程 URL PNG 后处理已完成，P4F 原生工程目录落盘已完成，P4G 工程目录再打开/恢复已完成，P4H PSD-like 专业导出投影首刀已完成，P4I 原生工程目录远程资产持久化缓存已完成，P4J 扁平图拆层协议首刀已完成，P4K 扁平图 draft `canvas:design` artifact bridge 已完成，P4L 上传扁平图本地 draft adapter 已完成，P4M DesignCanvas 候选层切换首刀已完成，P4N 上传扁平图本地 heuristic seed 首刀已完成；真 PSD writer、复杂 matting / mask refine 与拆层执行链路仍未开始。

计划：

1. 上传扁平图后识别主体、文字、Logo、背景候选层。
2. 通过 mask / matting / clean plate 建立可编辑文档。
3. 先稳定导出 PNG + JSON + assets，再试点 PSD-like 投影。
4. P4A 当前只做浏览器下载投影，不新增 Tauri 二进制写文件命令。
5. P4B 先用前端无依赖 ZIP 打包形成可交换工程包，仍不新增 Tauri 写文件命令。
6. P4C 先把 `chroma_key_postprocess` 从 `runtimeContract` 贯穿到 media task worker 和结果元数据；真实像素处理单独作为下一刀。
7. P4D 先在 media task worker 内处理 `data:image/png;base64`，把 chroma-key 背景像素 alpha 置 0；远程 URL 与复杂抠图留给后续缓存 / matting 阶段。
8. P4E 继续在 media task worker 内处理 provider 返回的 http/https PNG URL，下载只在任务执行期发生，并受大小上限约束；持久化缓存与工程目录落盘仍单独推进。
9. P4F 把当前浏览器 ZIP 下载推进为 Tauri current 命令 `save_layered_design_project_export`：只写项目根目录下 `.lime/layered-designs/<document>.layered-design/`，继续消费 `LayeredDesignDocument` 导出投影，不新增 provider adapter 或旧 poster 协议。
10. P4G 在同一条 current 工程目录链路补 `read_layered_design_project_export`：只读 `.lime/layered-designs/<document>.layered-design/design.json`，恢复 `LayeredDesignDocument` 到 `DesignCanvas`，不读取或定义新的设计事实源。
11. P4H 先定义 `psd-like-manifest.json` 专业层栈投影并随 ZIP / 原生工程目录导出；它只做 `LayeredDesignDocument` 的可交换投影，不写真 `.psd`，不做 OCR / matting / mask。
12. P4I 继续收口 current 工程目录保存/读取链路：保存时把 manifest 中的远程图片引用持久化到 `assets/`，读回时优先从缓存文件水合回 `design.json`，但不把 ZIP 浏览器导出扩展成第二套下载协议。
13. P4J 先不接模型，只把扁平图拆层需要的 current 协议落到 `LayeredDesignDocument`：记录 `source_image`、候选层、置信度、clean plate 状态，并用纯函数保证“只有已选候选层才 materialize 为正式 layers”，为后续拆层确认页和本地/远程 analyzer adapter 铺路。
14. P4K 在不新增命令和 UI 主入口的前提下，把扁平图拆层 draft 接回 current `canvas:design` Artifact 链：新增 `createLayeredDesignArtifactFromExtraction`，保证拆层 draft 可以像 prompt seed 一样进入 `DesignCanvasState`，继续复用现有 Canvas 主路径。
15. P4L 继续收口“上传扁平图”的本地入口：新增 `createLayeredDesignFlatImageDraftDocument` 和 `createLayeredDesignArtifactFromFlatImage`，让单张图片在没有 analyzer / OCR / mask 时也能先生成 extraction draft，后续只需替换 candidates/cleanPlate seed，不需要重开第二条 Canvas 接线。
16. P4M 先不做独立拆层确认页，直接在 current `DesignCanvas` 落一刀最小确认态：上传扁平图后可在属性栏切换候选层，保持 `extraction.candidates` 与正式 `layers` 的边界一致，为后续专门确认页先验证状态机。
17. P4N 继续在同一条 current 上传链上补本地 heuristic seed：先用浏览器本地裁片生成主体 / 标题文字 / Logo / 边角碎片候选，继续写回 `LayeredDesignDocument.extraction.candidates`，不伪装成 OCR / matting / clean plate，不新增独立确认页或新的 Artifact 类型。

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
14. 导出结果是 `LayeredDesignDocument` 的投影：`design.json` 会标记 `status: exported`，`preview.svg / preview.png` 只作为当前画布快照，不反向替代图层事实源。
15. 内嵌 data URL assets 可随导出下载；远程 assets 在 manifest 中保留 `originalSrc` 引用，不伪装成本地已落盘文件。
16. ZIP 工程包只是导出容器：`assets/` 只收纳内嵌 data URL 资产，远程资产继续只在 manifest 中保留引用，避免把不可控远程资源伪装成本地工程文件。
17. 图片任务 artifact 必须保留调用方传入的 `runtime_contract.layered_design` 扩展字段，同时继续保留标准 `image_generation` executor / policy / routing 合同；不能用默认 runtime contract 覆盖设计图层扩展。
18. `chroma_key_postprocess` 的 worker 合同必须先保持可追踪：生成请求提示词明确 chroma-key 背景，`result.postprocess` 和 `images[].postprocess` 持续写入同一套后处理元数据，前端写回 `GeneratedDesignAsset.params.postprocess` 不得丢失状态。
19. `chroma_key_postprocess` 的首个真实像素处理器必须至少消费 `data:image/png;base64`：成功时替换 `images[].url` 为透明 PNG data URL，并写入 `status: succeeded / removed_pixel_count / total_pixel_count / transparent`。
20. http/https 远程 URL 后处理必须受控：只允许下载任务结果 URL，限制最大图片体积，成功后仍回写透明 PNG data URL；失败只写 `postprocess.status: failed/skipped_unsupported_source`，不得让图片任务整体失败，也不得伪装为已透明化。
21. 原生工程目录落盘必须只保存导出投影：Tauri 侧负责路径约束、目录创建、UTF-8 / base64 文件写入和目录穿越防护；`preview.png` 与 `assets/` 仍是投影文件，不能反向替代 `LayeredDesignDocument`。
22. 工程目录读回必须只恢复 `design.json` 中的 `LayeredDesignDocument`：Tauri 侧负责约束目录必须位于 `.lime/layered-designs/`，前端负责 `normalizeLayeredDesignDocument` 后回写 `DesignCanvas`，manifest / preview / assets 只作为旁路投影元数据。
23. PSD-like manifest 必须是导出投影而非新事实源：`source.factSource` 必须指向 `LayeredDesignDocument`，`compatibility.truePsd=false`，图层顺序固定为 `back_to_front`，不得引入 `poster_generate / canvas:poster / ImageTaskViewer`。
24. 原生工程目录保存命令可以在不新增协议面的前提下，把 `export-manifest.json` 中 `http/https` 远程图片引用持久化缓存到 `assets/`；读回时优先从缓存文件水合 `design.json` 返回给前端，避免重新打开工程时仍依赖远程 URL 在线可达。
25. 扁平图拆层候选必须作为 `LayeredDesignDocument.extraction.candidates` 单独记录；候选层在用户确认前不能静默混入正式 `layers`。
26. 低置信度拆层候选默认不选中；即使候选附带 mask / RGBA 资产，也只能在 `selected=true` 后才 materialize 到 `DesignCanvas` 图层栈。
27. clean plate 失败不能阻断进入可编辑工程；背景层必须可回退到 `source_image`，同时在 extraction 元数据里保留失败状态和说明。
28. 扁平图拆层 draft 一旦进入 current Artifact 主链，仍必须继续使用 `canvas:design`；不为拆层草稿新增 `canvas:image`、`canvas:poster` 或平行 viewer 协议。
29. 上传扁平图的本地 draft adapter 只能做归一化和最小默认值推导；它不能伪装成真实 analyzer、OCR、matting 或 clean plate 结果，也不能偷偷扩成新的事实源 schema。
30. `DesignCanvas` 内的候选层切换只能修改 `extraction.candidates.selected` 并同步 materialize 结果；未选候选不能因为画布交互而静默出现在正式 `layers`。
31. 上传扁平图的本地 heuristic seed 只能产出基于原图的裁片候选；它可以帮助 current 画布先验证候选层状态机，但不能伪装成真实 mask、透明抠图、OCR 文字层或 clean plate 成果。

## 验证策略

当前改动横跨 TypeScript 协议、Artifact adapter、Workspace Canvas UI、Tauri 命令、DevBridge、mock 与治理 catalog；每一刀按实际触达边界选择最小可证明交付的校验集合。

最低校验：

```bash
npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/planner.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/generation.test.ts" "src/lib/layered-design/imageModelCapabilities.test.ts" "src/lib/layered-design/imageTasks.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/artifact/canvasAdapterUtils.test.ts" "src/components/artifact/ArtifactRenderer.ui.test.tsx"
npm exec -- eslint "src/lib/layered-design/**/*.ts" "src/components/artifact/canvasAdapterUtils.ts" "src/components/artifact/canvasAdapterUtils.test.ts" --max-warnings 0
npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit
npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000
```

GUI 主路径当前已补齐的 smoke 门槛：

```bash
npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000
npm run verify:gui-smoke -- --reuse-running --timeout-ms 600000 --interval-ms 1000
```

后续若继续改 Workspace / Design Canvas / DevBridge 主路径，应继续把 `npm run verify:gui-smoke` 纳入收口门槛；若只是纯函数或局部 UI 小改，可先跑定向 Vitest、ESLint 和 TypeScript 后再按风险升级。

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
- 已再次尝试 `npm run verify:gui-smoke -- --timeout-ms 600000 --interval-ms 1000`；本轮未走到新增 `smoke:design-canvas`，而是在既有 `smoke:agent-runtime-tool-surface-page` 超时。随后单独复跑该旧 smoke，失败点为 `launch_browser_session` 多次 DevBridge 响应超时；该失败归类为既有 browser runtime / 本地端口状态问题，不来自 `canvas:design`。

### 2026-05-05 P3H / P4A Design Canvas 专属 smoke 与导出首刀

- 已新增 `src/pages/design-canvas-smoke.tsx`，DEV-only 挂载 `/design-canvas-smoke`，从 `createLayeredDesignArtifactFromPrompt -> createCanvasStateFromArtifact -> CanvasFactory` 进入真实 `canvas:design` 页面。
- 已新增 `scripts/design-canvas-smoke.mjs` 与 `package.json` 脚本 `smoke:design-canvas`，验证 `canvas:design`、`LayeredDesignDocument`、图层栏、属性栏、生成/刷新/单层重生成/导出入口，以及图层选择、右移、隐藏、显示交互。
- 已修正 `scripts/design-canvas-smoke.mjs`：优先使用系统 Chrome channel，缺失时回退 Playwright Chromium；图层与属性按钮定位改为精确 accessible name，避免与图层列表“显示/隐藏”元信息冲突。
- 已新增 `src/lib/layered-design/export.ts`，把 `LayeredDesignDocument` 投影为 `design.json`、`export-manifest.json`、`preview.svg`、`preview.png` 和可下载内嵌 data URL assets，不新增 Tauri 命令。
- `export-manifest.json` 会区分 `file / reference / missing`：内嵌 data URL assets 可下载成文件，远程 assets 保留 `originalSrc` 引用，避免伪装成本地 assets 已落盘。
- `DesignCanvas` 顶部工具栏已把旧占位“PNG 导出待接入”替换为“导出设计工程”，点击后下载设计 JSON、manifest、SVG、PNG 和内嵌 assets；PNG 由当前 SVG 投影转换而来，仍不是事实源。
- 已补 `src/lib/layered-design/export.test.ts` 与 `src/components/workspace/design/DesignCanvas.test.tsx` 回归，覆盖导出包结构、SVG 可见图层投影、文本转义、远程 assets 引用、UI 导出入口。
- 已通过汇总回归：`npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/planner.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/generation.test.ts" "src/lib/layered-design/imageModelCapabilities.test.ts" "src/lib/layered-design/imageTasks.test.ts" "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/artifact/canvasAdapterUtils.test.ts" "src/components/artifact/ArtifactRenderer.ui.test.tsx"`，共 47 个测试。
- 已通过定向 ESLint：`npm exec -- eslint "src/lib/layered-design/**/*.ts" "src/components/workspace/design/**/*.{ts,tsx}" "scripts/design-canvas-smoke.mjs" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。该临时 tsconfig 为规避既有 `src/lib/sceneapp/product.ts` 对 ES2022 `Array.prototype.at` 的依赖，显式使用 `lib: ["ES2022", "DOM", "DOM.Iterable"]`。
- 已通过专属 GUI smoke：`npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`，真实页面验证通过，项目为默认 workspace `849e36ff-8f64-45ed-ba51-aab6b8e182e4`。
- 截至 2026-05-05 该刀收口前，完整 `verify:gui-smoke` 尚未通过；后续 2026-05-06 记录已完成仓库级 smoke 收口。

### 2026-05-06 P4A GUI smoke 收口

- 已修正 `scripts/agent-runtime-tool-surface-page-smoke.mjs` 的托管 Chrome 会话恢复逻辑：当 `browser_execute_action` 遇到 `CDP 调试端口不可用`、`没有可用的 Chrome 会话` 或 `未找到 profile_key=` 时，限次重启同一 smoke profile 后继续当前检查，避免本地 Chrome profile 抖动误报为产品失败。
- 已通过 `npm exec -- eslint "scripts/agent-runtime-tool-surface-page-smoke.mjs" --max-warnings 0`。
- 已通过单独旧 smoke 复测：`npm run smoke:agent-runtime-tool-surface-page -- --timeout-ms 180000 --interval-ms 1000`。
- 已通过完整 GUI smoke：`npm run verify:gui-smoke -- --reuse-running --timeout-ms 600000 --interval-ms 1000`。
- 本轮完整 GUI smoke 覆盖 `workspace-ready`、`browser-runtime`、`site-adapters`、`agent-service-skill-entry`、`agent-runtime-tool-surface`、`agent-runtime-tool-surface-page`、`knowledge-gui` 与新增 `design-canvas`；其中 `smoke:design-canvas` 真实验证 `canvas:design`、`LayeredDesignDocument`、图层栏、属性栏、生成/刷新/单层重生成/导出入口，以及图层选择、右移、隐藏、显示。
- 当前结论：`canvas:design` 已达到 Lime GUI 最小可交付门槛；尚未完成的是原生工程目录落盘、media task worker 后处理 seam、PSD-like 投影与扁平图拆层。

### 2026-05-06 P4B ZIP 工程包导出

- 已新增 `src/lib/layered-design/zip.ts`，实现无依赖 stored ZIP writer；该工具只负责 ZIP 容器，不懂 `LayeredDesignDocument` 语义，避免把打包细节塞进设计协议。
- 已扩展 `src/lib/layered-design/export.ts`：`createLayeredDesignExportZipFile` 会把 `design.json`、`export-manifest.json`、`preview.svg`、调用方生成的 `preview.png` 和内嵌 data URL assets 打进单个 `.layered-design.zip`。
- `DesignCanvas` 的“导出设计工程”入口已从散落下载多个文件改为下载单个 ZIP；包内 `assets/` 只包含内嵌 data URL assets，远程 assets 仍只在 manifest 中保留 `originalSrc` 引用。
- 已补 `src/lib/layered-design/export.test.ts`，读取 ZIP local headers 校验包内路径为 `design.json / export-manifest.json / preview.svg / preview.png / assets/...`，并断言不回流 `poster_generate / canvas:poster`。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx`，验证导出入口只触发一次 ZIP 下载，而不是多个散文件下载。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx"`，共 12 个测试。
- 已通过 `npm exec -- eslint "src/lib/layered-design/export.ts" "src/lib/layered-design/zip.ts" "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`。
- 已通过 `npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 已尝试 `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`，但本地 DevBridge 未监听 `3030`，停在 `stage=wait-health` 后失败；随后 `npm run bridge:health -- --timeout-ms 10000` 也确认 `fetch failed`。本轮曾尝试启动 `npm run tauri:dev:headless`，但被已有 Cargo artifact lock 阻塞，已终止本轮启动进程，未处理其他已有 Rust / dev 进程。
- 当前结论：浏览器侧已经具备单文件设计工程包代码路径与组件级回归；GUI smoke 需要等本地 DevBridge 恢复后补跑。下一刀应接 media task worker 的 `chroma_key_postprocess` seam，而不是继续扩展导出 UI。

### 2026-05-06 P4C media task chroma-key 后处理 seam

- 已修复 `src-tauri/src/commands/media_task_cmd.rs`：`create_image_generation_task_artifact_inner` 现在会把请求中的 `runtime_contract` 合并进标准 `image_generation_runtime_contract()`，保留 `layered_design` 扩展，同时不允许覆盖标准 `contract_key / executor_binding / policy / routing` 主合同。
- 已扩展 `src-tauri/crates/media-runtime/src/lib.rs`：图片 worker 会从 `payload.runtime_contract.layered_design.alpha` 读取 `chroma_key_postprocess`，给每个请求 slot prompt 追加 chroma-key 背景约束，并在 `result.postprocess` 与 `images[].postprocess` 写入 `pending_chroma_key_processor` seam。
- 已扩展 `src/lib/layered-design/imageTasks.ts`：`GeneratedDesignAsset.params.postprocess` 会保留 worker 写回的后处理状态，后续像素级处理器可以按 `taskId / documentId / layerId / originalAssetId` 找回上下文。
- 已补 `src-tauri/src/commands/media_task_cmd.rs` 回归，证明图片任务 artifact 同时保留标准 executor binding 和 `layered_design.alpha.strategy = chroma_key_postprocess`。
- 已补 `src-tauri/crates/media-runtime/src/lib.rs` 回归，证明 worker 能消费 layered-design alpha contract、追加 chroma-key prompt hint，并写出 `pending_chroma_key_processor` 结果 seam。
- 已补 `src/lib/layered-design/imageTasks.test.ts` 回归，证明前端写回资产时不会丢失 worker postprocess metadata。
- 已通过 `npm exec -- vitest run "src/lib/layered-design/imageTasks.test.ts" "src/lib/layered-design/imageModelCapabilities.test.ts"`，共 13 个测试。
- 已通过 `npm exec -- eslint "src/lib/layered-design/imageTasks.ts" "src/lib/layered-design/imageTasks.test.ts" --max-warnings 0`。
- 已通过 `npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 已通过 `CARGO_TARGET_DIR="/tmp/lime-p4c-media-runtime-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-media-runtime prepare_image_task_input_should_consume_layered_design_chroma_key_postprocess_contract`。
- 已通过 `CARGO_TARGET_DIR="/tmp/lime-p4c-app-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib create_image_generation_task_artifact_inner_should_preserve_layered_design_runtime_contract --no-default-features`。
- 已通过命令契约门禁：`npm run test:contracts`。
- 当前结论：`chroma_key_postprocess` 已从 LayeredDesignDocument 图层任务 contract 贯穿到标准 image task artifact、worker 请求与结果回写；下一刀才做真实像素级 key color -> alpha 处理或原生工程目录落盘。

### 2026-05-06 P4D data URL PNG chroma-key 像素级后处理

- 已为 `lime-media-runtime` 增加最小依赖 `base64` 与 `image`，只用于 worker 内 PNG data URL 解码、像素遍历和透明 PNG 编码；没有新增 provider adapter、Tauri 命令或 Python/CLI 旁路。
- 已扩展 `src-tauri/crates/media-runtime/src/lib.rs`：当图片服务返回 `data:image/png;base64` 且任务带 `runtime_contract.layered_design.alpha.strategy = chroma_key_postprocess` 时，worker 会按 `chroma_key_color` 计算颜色距离，把命中像素 alpha 置 0，并用新的透明 PNG data URL 替换 `images[].url`。
- `images[].postprocess` 现在会写入 `status: succeeded`、`removed_pixel_count`、`total_pixel_count`、`output_mime: image/png`、`transparent: true`；最终 `result.postprocess` 会聚合 `processed / succeeded / skipped / failed` 计数。
- 远程 URL 或非 PNG data URL 不会让图片任务失败；worker 保留原始 `url`，并写入 `status: skipped_unsupported_source` 与原因，避免把不可处理资产伪装成透明图层。
- 已更新 `src/lib/layered-design/imageTasks.test.ts`，验证前端资产写回会保留 worker 的 `succeeded` 后处理元数据与像素统计。
- 已通过前端定向回归：`npm exec -- vitest run "src/lib/layered-design/imageTasks.test.ts" "src/lib/layered-design/imageModelCapabilities.test.ts"`，共 13 个测试。
- 已通过前端定向 ESLint：`npm exec -- eslint "src/lib/layered-design/imageTasks.ts" "src/lib/layered-design/imageTasks.test.ts" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 已通过 Rust 定向回归：`CARGO_TARGET_DIR="/tmp/lime-p4d-media-runtime-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-media-runtime chroma_key`。
- 已通过 Rust crate 回归：`CARGO_TARGET_DIR="/tmp/lime-p4d-media-runtime-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-media-runtime`，共 17 个测试。
- 已通过 diff 卫生检查：`git diff --check -- "src-tauri/Cargo.lock" "src-tauri/crates/media-runtime/Cargo.toml" "src-tauri/crates/media-runtime/src/lib.rs" "src/lib/layered-design/imageTasks.ts" "src/lib/layered-design/imageTasks.test.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`。
- 当前结论：`LayeredDesignDocument -> image task artifact -> media-runtime -> GeneratedDesignAsset.params.postprocess` 已具备首个真实透明图层生成闭环；后续仍需远程资产缓存后处理、复杂 matting / mask refine、PSD-like 投影和扁平图拆层。

### 2026-05-06 P4E 远程 URL PNG chroma-key 后处理

- 已继续扩展 `src-tauri/crates/media-runtime/src/lib.rs`：当 provider 返回 `http/https` 图片 URL 且任务带 `chroma_key_postprocess` 时，worker 会在任务执行期受控下载该 URL，再复用同一套 PNG 像素处理器输出透明 PNG data URL。
- 远程下载只允许 `http/https`，并设置 `IMAGE_TASK_POSTPROCESS_MAX_IMAGE_BYTES = 20 MiB` 上限；非 URL、非支持 scheme、下载失败、状态非成功或超限都只写后处理 `failed/skipped_unsupported_source`，不让图片任务整体失败。
- `images[].postprocess.input_source` 现在可区分 `data_url` 与 `remote_url`；远程 URL 成功时 `images[].url` 会从原始 URL 替换为 `data:image/png;base64,...`，继续保留 `removed_pixel_count / total_pixel_count / transparent`。
- 已补 Rust 集成回归 `execute_image_generation_task_should_postprocess_remote_chroma_key_url`，用本地 Axum 同时模拟图片生成接口和远程 PNG 资源，验证 worker 最终写回透明 data URL 且绿色像素 alpha=0、红色像素 alpha=255。
- 已通过 Rust 定向回归：`CARGO_TARGET_DIR="/tmp/lime-p4e-media-runtime-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-media-runtime chroma_key`，共 3 个测试。
- 已通过 Rust crate 回归：`CARGO_TARGET_DIR="/tmp/lime-p4e-media-runtime-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-media-runtime`，共 18 个测试。
- 已通过 diff 卫生检查：`git diff --check -- "src-tauri/Cargo.lock" "src-tauri/crates/media-runtime/Cargo.toml" "src-tauri/crates/media-runtime/src/lib.rs" "src/lib/layered-design/imageTasks.ts" "src/lib/layered-design/imageTasks.test.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`。
- 当前结论：`chroma_key_postprocess` 已覆盖 provider 返回 `b64_json -> data URL` 与 `url -> http/https PNG` 两类主流图片结果；后续仍需持久化资产缓存、原生工程目录落盘、PSD-like 投影、复杂 matting / mask refine 与扁平图拆层。

### 2026-05-06 P4F 原生工程目录落盘

- 已新增 `src/lib/api/layeredDesignProject.ts`，前端只通过 API 网关调用 current Tauri 命令 `save_layered_design_project_export`，没有在 `DesignCanvas` 里散落裸 `invoke`。
- 已扩展 `src/lib/layered-design/export.ts`：在 ZIP 投影之外新增 `createLayeredDesignProjectExportFiles`，把同一份 `LayeredDesignDocument` 导出投影拆成可由 Tauri 写入的 `design.json / export-manifest.json / preview.svg / preview.png / assets/*` 文件列表。
- 已新增 `src-tauri/src/commands/layered_design_cmd.rs`：只把导出文件写入项目根目录下 `.lime/layered-designs/<document>.layered-design/`，并校验项目根目录必须是绝对路径、导出相对路径不得目录穿越、文件内容仅支持 `utf8 / base64`。
- 已同步命令四侧：Rust `runner.rs` 注册、DevBridge dispatcher、`agentCommandCatalog.fileBrowserCommands`、`mockPriorityCommands` 与 `defaultMocks`；并在 `docs/aiprompts/commands.md` 记录该命令仍属于 `LayeredDesignDocument -> canvas:design` 主链。
- `DesignCanvas` 现在在绑定 `projectRootPath` 时默认保存到项目工程目录；只有未绑定工作区时才回退浏览器 `.layered-design.zip` 下载，避免把浏览器下载误称为原生落盘。
- 已补 `src/lib/layered-design/export.test.ts`、`src/components/workspace/design/DesignCanvas.test.tsx`、`src/lib/tauri-mock/core.test.ts` 与 `src/lib/dev-bridge/mockPriorityCommands.test.ts` 回归，覆盖 Tauri 文件列表、项目目录保存、不触发浏览器下载、mock 命令可用。
- 已通过前端定向回归：`npm exec -- vitest run "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx"`，共 14 个测试。
- 已通过 mock / bridge 定向回归：`npm exec -- vitest run "src/lib/tauri-mock/core.test.ts" "src/lib/dev-bridge/mockPriorityCommands.test.ts"`，共 26 个测试。
- 已通过定向 ESLint：`npm exec -- eslint "src/lib/api/layeredDesignProject.ts" "src/lib/layered-design/export.ts" "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/workspace/design/types.ts" "src/lib/dev-bridge/mockPriorityCommands.ts" "src/lib/tauri-mock/core.ts" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 已通过 Rust 定向回归：`CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR="/Users/coso/Library/Caches/lime-p4f-layered-design-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib save_layered_design_project_export --no-default-features`，共 2 个测试。
- 已通过命令契约门禁：`npm run test:contracts`。
- 已通过专属 GUI smoke：`npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`，真实页面验证 `canvas:design`、图层交互和导出入口仍可打开。
- 已通过完整 GUI smoke：`npm run verify:gui-smoke -- --reuse-running --timeout-ms 600000 --interval-ms 1000`。
- 已通过 diff 卫生检查：`git diff --check -- "src/lib/api/layeredDesignProject.ts" "src/lib/layered-design/export.ts" "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/workspace/design/types.ts" "src-tauri/src/commands/layered_design_cmd.rs" "src-tauri/src/commands/mod.rs" "src-tauri/src/app/runner.rs" "src-tauri/src/dev_bridge/dispatcher/files.rs" "src/lib/dev-bridge/mockPriorityCommands.ts" "src/lib/tauri-mock/core.ts" "src/lib/governance/agentCommandCatalog.json" "docs/aiprompts/commands.md"`。
- 当前结论：P4F 的 current 代码路径、命令契约、Rust 写盘内核和 GUI 主路径均已验证通过；后续可进入 PSD-like 投影或扁平图拆层，不需要回到旧 poster / ImageTaskViewer 链路。

### 2026-05-06 P4G 工程目录再打开 / 恢复

- 已扩展 current API 网关 `src/lib/api/layeredDesignProject.ts`：新增 `readLayeredDesignProjectExport`，继续通过 `safeInvoke` 调用 `read_layered_design_project_export`，页面层没有散落裸 `invoke`。
- 已扩展 `src-tauri/src/commands/layered_design_cmd.rs`：新增只读请求/输出结构和 `read_layered_design_project_export_inner`，支持显式相对目录或自动选择最近保存的 `.lime/layered-designs/*.layered-design/`，只读取 `design.json` 与可选 `export-manifest.json`。
- 读取命令会校验 `projectRootPath` 必须是绝对路径、指定导出目录必须位于 `.lime/layered-designs/` 下；非导出目录或缺少 `design.json` 会失败，不会把普通目录误当设计工程。
- 已同步命令四侧：Rust `runner.rs` 注册、DevBridge dispatcher、`agentCommandCatalog.fileBrowserCommands`、`mockPriorityCommands` 与 `defaultMocks`；`docs/aiprompts/commands.md` 已记录保存/读取同属 `LayeredDesignDocument -> canvas:design` current 工程目录链路。
- `DesignCanvas` 新增“打开最近工程”入口：绑定 `projectRootPath` 后读取最近工程，`JSON.parse(designJson)` 后通过 `normalizeLayeredDesignDocument` 恢复文档，并自动选中恢复文档中最高 zIndex 图层，继续沿同一个编辑器状态工作。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx` 回归，覆盖“打开最近工程”后恢复 `LayeredDesignDocument`、继续编辑状态和旧 `poster_generate / canvas:poster / ImageTaskViewer` 不回流。
- 已补 `src/lib/tauri-mock/core.test.ts` 与 `src/lib/dev-bridge/mockPriorityCommands.test.ts` 回归，覆盖保存/读取 mock 闭环和浏览器模式 mock 优先命令集合；`scripts/design-canvas-smoke.mjs` 也检查“打开最近工程”入口存在。
- 已通过前端定向回归：`npm exec -- vitest run "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/tauri-mock/core.test.ts" "src/lib/dev-bridge/mockPriorityCommands.test.ts"`，共 43 个测试。
- 已通过定向 ESLint：`npm exec -- eslint "src/lib/api/layeredDesignProject.ts" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/workspace/design/types.ts" "src/lib/dev-bridge/mockPriorityCommands.ts" "src/lib/dev-bridge/mockPriorityCommands.test.ts" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" "scripts/design-canvas-smoke.mjs" --max-warnings 0`。
- 已通过定向 TypeScript 检查：重建 `/tmp/lime-layered-design-tsconfig.json` 后执行 `npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 已通过 Rust 定向回归：`CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR="/Users/coso/Library/Caches/lime-p4g-layered-design-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib layered_design_project_export --no-default-features`，共 4 个测试。
- 已通过命令契约门禁：`npm run test:contracts`。
- 已通过专属 GUI smoke：`npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`，真实页面验证 `canvas:design`、图层交互、导出入口和“打开最近工程”入口仍可打开。
- 已通过完整 GUI smoke：`npm run verify:gui-smoke -- --reuse-running --timeout-ms 600000 --interval-ms 1000`。
- 已通过 diff 卫生检查：`git diff --check` 覆盖 tracked 主线文件；未跟踪的新文件 `src-tauri/src/commands/layered_design_cmd.rs` 与 `src/lib/api/layeredDesignProject.ts` 已额外检查尾随空白和文件末尾换行。
- 当前结论：P4G 已补上 `生成/编辑 -> 保存项目工程目录 -> 重新打开 -> 继续编辑` 的最小 current 闭环；仍未完成的是持久化远程资产缓存、PSD-like 投影、复杂 matting / mask refine 与扁平图拆层。

### 2026-05-06 P4H PSD-like 专业导出投影

- 已扩展 `src/lib/layered-design/export.ts`：新增 `createLayeredDesignPsdLikeManifest` 与 `LAYERED_DESIGN_PSD_LIKE_EXPORT_SCHEMA_VERSION`，把 `LayeredDesignDocument` 投影为 `psd-like-layer-stack`。
- `psd-like-manifest.json` 会记录 `source.factSource=LayeredDesignDocument`、`compatibility.truePsd=false`、`layerOrder=back_to_front`，并把 image / effect、text、shape、group 分别投影为 raster image、editable text、vector shape 与 group reference。
- ZIP 工程包与 Tauri 工程目录文件列表现在都会包含 `design.json / export-manifest.json / psd-like-manifest.json / preview.svg / preview.png / assets/`；远程 assets 继续只保留 `source=reference` 与 `originalSrc`，不伪装成已缓存文件。
- `DesignCanvas` 导出文案已同步说明 `psd-like-manifest.json`，用户仍从同一个“导出设计工程”入口进入，不新增旧 poster、provider adapter 或平行主链。
- 已补 `src/lib/layered-design/export.test.ts` 回归，覆盖 PSD-like manifest 的事实源、兼容性声明、图层顺序、图层角色、远程 asset 引用和旧链路禁词。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx` 回归，覆盖导出入口文案和 Tauri 保存文件列表包含 `psd-like-manifest.json`。
- 已通过前端定向回归：`npm exec -- vitest run "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx"`，共 16 个测试。
- 已通过定向 ESLint：`npm exec -- eslint "src/lib/layered-design/export.ts" "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`。
- 已通过定向 TypeScript 检查：`npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`。
- 已通过专属 GUI smoke：`npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`。
- 已通过完整 GUI smoke：`npm run verify:gui-smoke -- --reuse-running --timeout-ms 600000 --interval-ms 1000`。
- 当前结论：P4H 完成的是专业层栈 manifest 投影，不是真 PSD writer；仍未完成的是持久化远程资产缓存、真 PSD 文件导出 / 打开验证、复杂 matting / mask refine、OCR 与扁平图拆层。

### 2026-05-06 P4I 原生工程目录远程资产持久化缓存

- 已继续扩展 `src-tauri/src/commands/layered_design_cmd.rs`，但没有新增命令名：`save_layered_design_project_export` 现在会解析 `export-manifest.json` 中 `source=reference + originalSrc=http/https` 的远程图片资产，并在保存工程目录时尝试持久化到 `assets/`。
- 远程缓存成功后，命令会把 `export-manifest.json` 与 `psd-like-manifest.json` 中对应资产从 `reference` 更新为 `file`，同时继续保留 `originalSrc`，确保导出 projection 明确说明“这是缓存副本，不是新的事实源 URL”。
- `design.json` 磁盘文件仍保持原始导出投影，不在保存阶段偷偷改成第二套协议；重新打开时由 `read_layered_design_project_export` 优先读取 manifest 指向的缓存文件，把对应 asset 水合回 data URL，再返回给前端 `DesignCanvas`。
- 这刀的直接收益是：远程图片图层在“保存项目工程目录 -> 重新打开 -> 继续编辑”链路里不再完全依赖远程 URL 在线可达；即使原始 provider URL 后续失效，只要缓存文件仍在，本地工程仍能继续打开编辑。
- 本轮不扩浏览器 ZIP 下载的远程缓存；ZIP 仍保持“嵌入 data URL 资产直接打包，远程资产保留引用”。这样避免为了浏览器侧旁路再引入第二套下载/权限模型。

### 2026-05-06 P4J 扁平图拆层协议首刀

- 已在 `src/lib/layered-design/types.ts` 给 `LayeredDesignDocument` 增加兼容扩展字段 `extraction`，并补 `GeneratedDesignAsset.kind = "source_image"`，让扁平图来源资产、候选层、置信度和 clean plate 状态都能稳定回挂到 current 事实源，而不是另起一套拆层中间协议。
- 已在 `src/lib/layered-design/document.ts` 增加 extraction normalization：候选层会被强制标记 `source: "extracted"`，低置信度自动补 `low_confidence`，并把 extraction 附带的 `clean_plate` / 候选资产吸收到顶层 `assets`，避免后续 UI 或导出在事实源内读到“候选引用了不存在的资产”。
- 已新增 `src/lib/layered-design/extraction.ts` 纯函数，提供 `createLayeredDesignExtractionDocument` 和 `updateLayeredDesignExtractionSelection`：前者把扁平图、候选层、clean plate 结果归一为 draft 文档，后者只把 `selected=true` 的候选 materialize 到正式 `layers`，未选候选继续只存在于 `extraction.candidates`。
- clean plate 成功时，背景层默认引用 `clean_plate`；clean plate 失败时，背景层自动回退到 `source_image`，同时保留 `extraction.cleanPlate.status/message`，确保“可继续编辑”和“风险显式暴露”同时成立。
- 本轮仍不接 OCR / SAM / matting / inpaint 真执行，也不接拆层确认页；这刀只把后续拆层执行链路需要的协议和不变量先钉死在 current 主链上。
- 已验证：
  - `npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/extraction.test.ts"`
  - `npm exec -- eslint "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/extraction.ts" "src/lib/layered-design/extraction.test.ts" --max-warnings 0`
  - `npm exec -- tsc -p "/tmp/lime-layered-design-extraction-tsconfig.json" --noEmit`

### 2026-05-06 P4K 扁平图 draft `canvas:design` Artifact bridge

- 已在 `src/lib/layered-design/artifact.ts` 新增 `createLayeredDesignArtifactFromExtraction`，把扁平图拆层 draft 的创建和 Artifact 包装放在同一条 current helper 链里，避免后续上传/拆层入口再临时拼装 `canvas:design` JSON。
- 这个 bridge 明确把拆层 draft 归类为 `meta.source = "layered-design-extraction"`，继续沿用现有 `canvas:design`、`platform: layered-design` 和 `designId` 语义，不新增拆层专用 Artifact type，也不回流旧 `canvas:poster` / `ImageTaskViewer` 路线。
- `src/lib/layered-design/artifact.test.ts` 已补回归：扁平图 draft 打开到 `DesignCanvasState` 后，只会 materialize 已选/高置信度候选层；低置信度碎片候选仍只留在 `document.extraction.candidates`，保持确认前后边界一致。
- 这刀的直接收益是：后续不管拆层结果来自本地 analyzer、远程任务还是 mock，都能先归一为 `LayeredDesignDocument`，再复用现有 Artifact/Canvas 主链进入编辑，不需要为拆层入口再开第二套 Viewer/Workspace 路径。
- 已验证：
  - `npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/artifact.test.ts"`
  - `npm exec -- eslint "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/extraction.ts" "src/lib/layered-design/artifact.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/artifact.test.ts" --max-warnings 0`
  - `npm exec -- tsc -p "/tmp/lime-layered-design-extraction-tsconfig.json" --noEmit`

### 2026-05-06 P4L 上传扁平图本地 draft adapter

- 已新增 `src/lib/layered-design/flatImage.ts`，提供 `createLayeredDesignFlatImageDraftDocument`：输入只需要上传图片的 `src/width/height` 与可选 `fileName`，就能自动推导 `document id/title`、`source_image asset`、canvas 尺寸，并产出一个最小 extraction draft。
- 这个 adapter 复用了前一刀的 extraction 协议，而不是新开一套“上传图片草稿” schema：即使当前还没有 analyzer / OCR / clean plate 结果，也仍然先生成 `LayeredDesignDocument.extraction`，背景层默认回指原始 `source_image`。
- 已在 `src/lib/layered-design/artifact.ts` 新增 `createLayeredDesignArtifactFromFlatImage`，让单张上传图片可以直接落成 current `canvas:design` Artifact；它继续复用 `layered-design-extraction` 元数据来源，不额外扩 metadata 面。
- `src/lib/layered-design/flatImage.test.ts` 证明两点：一是纯上传图可以直接进入“只有背景层”的最小 draft；二是同一个 adapter 可以在有本地候选 seed 时只 materialize 高置信度候选层，把低置信度碎片继续留在 `extraction.candidates`。
- `src/lib/layered-design/artifact.test.ts` 已补回归，证明 `createLayeredDesignArtifactFromFlatImage` 产出的 Artifact 可以直接进入 `DesignCanvasState`，不需要额外 JSON 拼装或第二条 Workspace 接线。
- 这刀的直接收益是：后续“上传扁平图”入口只要先拿到图片 bytes / data URL / 远程 URL 与尺寸，就已经能稳定走到 current `canvas:design` 主链；未来接 analyzer 结果时只是在同一份 extraction draft 上补 candidates/cleanPlate，不用重写打开链路。
- 已验证：
  - `npm exec -- vitest run "src/lib/layered-design/document.test.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts"`
  - `npm exec -- eslint "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/extraction.ts" "src/lib/layered-design/flatImage.ts" "src/lib/layered-design/artifact.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts" --max-warnings 0`
  - `npm exec -- tsc -p "/tmp/lime-layered-design-flat-image-tsconfig.json" --noEmit`

### 2026-05-06 P4M DesignCanvas 候选层切换首刀

- 已在 `src/components/workspace/design/DesignCanvas.tsx` 新增两个 current UI 动作：工具栏的“上传扁平图”，以及属性栏里的“拆层候选”卡片。前者直接读取本地图片文件并落成 extraction draft，后者允许在同一个 `DesignCanvas` 内切换 `extraction.candidates.selected`。
- 这一刀没有新建独立拆层确认页，而是先把确认态压进现有 `DesignCanvas`，验证 `LayeredDesignDocument.extraction -> selected candidates -> layers` 这个最小状态机能否在 current 主路径内跑通。
- UI 语义保持和协议一致：低置信度候选仍会显示“低置信度”，但在用户点击前不会 materialize 到正式图层；点击后只改 `candidate.selected`，再由纯函数同步图层栈，不直接手改 `layers`。
- 这刀的直接收益是：上传扁平图后，用户已经可以在 current 画布里完成“原图进入编辑 -> 补选候选层 -> 成为正式图层”的最小操作，而不需要等待独立确认页或真实 analyzer 才能继续主链验证。
- 已验证：
  - `npm exec -- vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts"`
  - `npm exec -- eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/flatImage.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.ts" "src/lib/layered-design/artifact.test.ts" --max-warnings 0`
  - `npm run verify:gui-smoke -- --timeout-ms 600000 --interval-ms 1000`（已通过）

### 2026-05-06 P4N 上传扁平图本地 heuristic seed 首刀

- 已新增 `src/lib/layered-design/flatImageHeuristics.ts`，在浏览器本地对上传图片生成最小裁片候选：主体、标题文字、Logo 与边角碎片都继续回挂到 `LayeredDesignDocument.extraction.candidates`，不新增新的拆层 schema。
- `DesignCanvas` 的上传入口现在会优先尝试本地 heuristic seed：成功时直接带着裁片候选进入 current `canvas:design -> DesignCanvas` 主链；失败时回退为“只有背景层”的 draft，不阻断上传到 current 画布。
- 这刀仍然显式标注 clean plate 未执行，且只让高于阈值的主体 / 标题裁片默认进入正式图层；Logo 和碎片继续作为低置信度候选等待用户确认，避免把启发式裁片伪装成真实拆层结果。
- 这刀的直接收益是：`上传扁平图 -> extraction draft -> 候选层切换 -> 正式图层` 现在不再依赖手工伪造 seed 或未来 analyzer 才能演示，current `DesignCanvas` 已经能直接承接一条最小但真实的候选层闭环。
- 已验证：
  - `npm exec -- vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts"`
  - `npm exec -- eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/flatImage.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/artifact.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run verify:gui-smoke -- --timeout-ms 600000 --interval-ms 1000`
