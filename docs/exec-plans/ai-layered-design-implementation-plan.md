# AI 图层化设计实现执行计划

> 状态：P4I 原生工程目录远程资产持久化缓存已完成，P4J 扁平图拆层协议首刀已完成，P4K 扁平图 draft `canvas:design` artifact bridge 已完成，P4L 上传扁平图本地 draft adapter 已完成，P4M DesignCanvas 候选层切换首刀已完成，P4N 上传扁平图本地 heuristic seed 首刀已完成，P4O DesignCanvas 拆层确认态接线首刀已完成，P4P 扁平图 analyzer seam 与重新拆层入口已完成，P4Q DesignCanvas 拆层确认对照预览首刀已完成，P4R analyzer result metadata 首刀已完成，P4S 确认态 mask / OCR TextLayer 预览已完成，P4T structured analyzer result adapter 已完成，P4U 本地 heuristic mask / clean plate 真执行首刀已完成，P4V feature-detected OCR TextLayer 来源接入首刀已完成，P4W 可注入 OCR provider 来源接线已完成，P4X 原生 OCR provider bridge 首刀已完成，P4Y native OCR fallback/priority 回归闭环已完成，P4Z DesignCanvas 上传拆层 GUI smoke 已完成，P5A 可注入 structured analyzer provider seam 已完成，P5B structured provider -> `AnalyzeLayeredDesignFlatImage` adapter 已完成，P5C provider 失败回退本地 heuristic 已完成，P5D 前端 worker structured analyzer bridge 已完成，P5E worker runtime handler 已完成，P5F Worker local heuristic analyzer 已完成，P5G 可实例化浏览器 Worker analyzer 已完成，P5H DesignCanvas smoke Worker analyzer 注入已完成，P5I Tauri native structured analyzer command bridge 已完成，P5J-1 Worker refined subject mask seam 已完成，P5J-2 Worker refined clean plate seam 已完成，P5J-3 Worker text candidate extractor seam 已完成，P5J-4 Worker TextLayer runtime roundtrip 回归已完成，P5J-5 Worker Logo candidate refiner seam 已完成，P5J-6 Worker background fragment refiner seam 已完成，P5K-1 Worker refined seams DEV smoke fixture 已完成，P5L-1 Worker subject mask refiner seam 已完成，P5L-2 Worker subject mask runtime roundtrip 回归已完成，P5L-3 Worker subject matting DEV smoke fixture 已完成，P5L-4 subject matting provider adapter 已完成，P5L-5 deterministic subject matting provider 已完成，P5L-6 deterministic subject matting smoke 接入已完成，P5L-7 subject matting Worker protocol 已完成，P5L-8 subject matting browser Worker factory 已完成，P5L-9 subject matting Worker smoke 模式已完成，P5M-1 Worker OCR provider adapter 已完成，P5M-2 OCR Worker protocol 已完成，P5M-3 OCR browser Worker factory 已完成，P5M-4 OCR Worker smoke 模式已完成，P5M-5 OCR provider priority 组合器已完成，P5M-6 OCR priority smoke 模式已完成，P5N-1 简单 subject matting Worker 算法占位已完成，P5O-1 clean plate provider seam 已完成，P5O-3 clean plate 风险提示 UI 已完成，P5P-1 原生分层工程 roundtrip smoke 已完成，P5P-2 roundtrip 默认 smoke 门槛已完成，P5Q-1 简单像素级 clean plate Worker provider 已完成，P5Q-2 clean plate Worker protocol / browser factory 已完成，P5Q-3 clean plate Worker GUI smoke 可观测模式已完成；上传图片现在已能直接归一为 extraction draft、生成本地裁片候选、在 current `DesignCanvas` 内完成“确认候选 -> 进入图层编辑 -> 重新拆层 -> 再确认”，并且默认 analyzer 已开始产出真实 subject mask、近似 clean plate，以及在 native OCR / `TextDetector` / 调用方注入 OCR provider 有结果时直接生成可编辑 `TextLayer`；future real analyzer 也已有稳定的 `mask + TextLayer + clean plate -> LayeredDesignDocument.extraction` 收口适配层，并能通过可注入 provider、analyzer adapter、前端 worker bridge、worker runtime handler、Worker local heuristic analyzer、Worker refined subject mask seam、Worker refined clean plate seam、Worker text candidate extractor seam、Worker TextLayer runtime roundtrip、Worker Logo candidate refiner seam、Worker background fragment refiner seam、Worker refined seams DEV smoke fixture、Worker subject mask refiner seam、Worker subject mask runtime roundtrip 回归、Worker subject matting DEV smoke fixture、subject matting provider adapter、deterministic subject matting provider、deterministic subject matting smoke 接入、subject matting Worker protocol、subject matting browser Worker factory、subject matting Worker smoke 模式、Worker OCR provider adapter、OCR Worker protocol、OCR browser Worker factory、OCR Worker smoke 模式、OCR provider priority 组合器、OCR priority smoke 模式、简单 subject matting Worker 算法占位、clean plate provider seam、clean plate 风险提示 UI、原生分层工程 roundtrip smoke、roundtrip 默认 smoke 门槛、简单像素级 clean plate Worker provider、clean plate Worker protocol / browser factory、clean plate Worker GUI smoke 可观测模式、可实例化浏览器 Worker analyzer 或 Tauri native structured analyzer command bridge 接入 current `DesignCanvas` / `LayeredDesignDocument.extraction`，并已在 DEV-only DesignCanvas smoke 中验证 Worker analyzer 注入，provider / native 命令 unsupported 时仍可回退到本地 heuristic 保住 current 上传拆层主路径；定向单测、ESLint、定向 TypeScript、Rust 定向测试、命令契约与 DesignCanvas 专属 GUI smoke 已覆盖到对应边界
> 创建时间：2026-05-05
> 路线图来源：`docs/roadmap/ai-layered-design/README.md`
> 当前目标：围绕 `LayeredDesignDocument` current 事实源完成生成、编辑、任务回写、工程目录保存、恢复、PSD-like 专业层栈投影，以及扁平图拆层 draft/候选层切换、本地 heuristic seed、确认态接线、统一 analyzer seam、对照预览、analyzer result metadata、确认态 mask / OCR TextLayer 预览、structured analyzer result adapter、本地 heuristic mask / clean plate 真执行、feature-detected OCR TextLayer 来源接入、可注入 OCR provider 来源接线、原生 OCR provider bridge 首刀、native OCR fallback/priority 回归闭环、DesignCanvas 上传拆层 GUI smoke、可注入 structured analyzer provider seam、provider-to-analyzer adapter、provider 失败回退、前端 worker bridge 与 worker runtime handler、Worker local heuristic analyzer、可实例化浏览器 Worker analyzer、DEV-only DesignCanvas smoke 注入、Tauri native structured analyzer command bridge、Worker refined subject mask seam、Worker refined clean plate seam、Worker text candidate extractor seam、Worker TextLayer runtime roundtrip、Worker Logo candidate refiner seam、Worker background fragment refiner seam、Worker refined seams DEV smoke fixture、Worker subject mask refiner seam、Worker subject mask runtime roundtrip 回归、Worker subject matting DEV smoke fixture、subject matting provider adapter、deterministic subject matting provider、deterministic subject matting smoke 接入、subject matting Worker protocol、subject matting browser Worker factory、subject matting Worker smoke 模式、Worker OCR provider adapter、OCR Worker protocol、OCR browser Worker factory、OCR Worker smoke 模式、OCR provider priority 组合器、OCR priority smoke 模式、简单 subject matting Worker 算法占位、clean plate provider seam、clean plate 风险提示 UI、原生分层工程 roundtrip smoke 与 roundtrip 默认 smoke 门槛与简单像素级 clean plate Worker provider与 clean plate Worker protocol / browser factory与 clean plate Worker GUI smoke 可观测模式；下一步进入真实 VLM、跨平台 native OCR、生产级 matting / clean plate worker，或真 PSD writer、复杂 mask refine。

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
28. 新增 `DesignCanvas` 拆层确认态接线首刀：`LayeredDesignDocument.extraction.review` 现在可持久化 `pending/confirmed`，上传扁平图后先进入确认态，用户显式确认候选层或仅保留原图后，才切换到正式图层编辑。
29. 新增扁平图 analyzer seam 与重新拆层入口：上传扁平图和确认态里的“重新拆层”现在统一走 `analyzeLayeredDesignFlatImage` / `AnalyzeLayeredDesignFlatImage` adapter，默认实现仍是 local heuristic，不让 UI 直接耦合具体 seed helper。
30. 新增 `DesignCanvas` 拆层确认对照预览首刀：确认态现在可在同一面板内切换查看原图、当前候选和 clean plate（若有）预览；当前 local heuristic analyzer 尚未产出 mask，因此不伪装成真实 mask viewer。
31. 新增 `LayeredDesignDocument.extraction.analysis`：上传扁平图与重新拆层现在会把 analyzer 名称、生成时间与 `candidateRaster/candidateMask/cleanPlate/ocrText` 输出能力快照写回 current 事实源，确认态直接消费这份 metadata，而不是反向猜测具体 analyzer 行为。
32. 新增确认态 mask / OCR TextLayer 预览：确认态可查看候选 mask，并能把 OCR 文案候选按真实 `TextLayer` 渲染，不再把文字候选伪装成 raster-only 图层。
33. 新增 structured analyzer result adapter：future real analyzer 可先输出 image/mask/text/clean plate 结构化结果，再统一投影回 `LayeredDesignDocument.extraction`。
34. 新增本地 heuristic mask / clean plate 真执行首刀：默认 analyzer 已能生成主体 mask、带 alpha 主体候选与近似 clean plate，但仍明确标注为 local heuristic。
35. 新增 feature-detected OCR TextLayer 来源：宿主暴露 `TextDetector` 时，默认 analyzer 可把标题裁片升级为可编辑 `TextLayer`。
36. 新增可注入 OCR provider 来源：调用方可注入 native、worker 或真实 analyzer OCR 结果，仍通过同一 structured adapter 写回 current 事实源。
37. 新增原生 OCR provider bridge 首刀：默认 analyzer 会先尝试 current Tauri 命令 `recognize_layered_design_text`，失败或无结果再回退 `TextDetector`；命令边界已同步 Rust 注册、DevBridge、治理目录册与 browser mock。
38. 新增 native OCR fallback/priority 回归闭环：定向测试固定 native unsupported 时继续 fallback `TextDetector`，native 有结果时优先使用原生结果且不再调用浏览器 OCR。
39. 扩展 `smoke:design-canvas` 专属 GUI smoke：真实页面现在会上传一张生成的 PNG 扁平图，等待进入 extraction draft / 拆层确认态，再点击“进入图层编辑”完成 current GUI 闭环。
40. 新增可注入 structured analyzer provider seam：调用方可直接返回 image/mask/text/clean plate 结构化结果，替换本地 heuristic，但仍统一投影到 `LayeredDesignDocument.extraction`。
41. 新增 structured provider -> `AnalyzeLayeredDesignFlatImage` adapter：真实执行源可以直接包装成 `DesignCanvas.analyzeFlatImage` 所需接口，不需要 UI 感知 provider 细节。
42. 新增 provider 失败回退本地 heuristic：真实 analyzer provider 暂不可用或抛错时，adapter 会回退到 current 本地 analyzer，避免上传拆层主路径直接失败。
43. 新增前端 worker structured analyzer bridge：真实执行源可以用 Worker message protocol 返回 structured result，再继续通过现有 provider / analyzer adapter 写回 current extraction。
44. 新增 worker runtime handler：真实 Worker 内部只要安装 structured provider，就能消费同一 request protocol 并回传 result/error，不再只有主线程侧调用壳。
45. 新增 Worker local heuristic analyzer：Worker 内可用 OffscreenCanvas 执行候选裁片、主体椭圆 mask、近似 clean plate，并返回 structured result。
46. 新增可实例化浏览器 Worker analyzer：前端可直接创建真实 module Worker，组合 worker provider、adapter 与 fallback，作为 `AnalyzeLayeredDesignFlatImage` 注入 current UI。
47. 新增 DEV-only DesignCanvas smoke Worker analyzer 注入：`/design-canvas-smoke?analyzer=worker` 会把 Worker analyzer 作为 current `DesignCanvas.analyzeFlatImage` 注入并跑真实上传拆层 GUI 闭环。
48. 新增 Tauri native structured analyzer command bridge：`analyze_layered_design_flat_image` 只支持 `data:image/png;base64` 首刀，把 native heuristic crop / mask / clean plate structured result 经前端 provider seam 投影回 `LayeredDesignDocument.extraction`；unsupported 返回 fallback，不新增旧 poster/provider adapter。
49. 新增 Worker refined subject mask seam：Worker heuristic 优先用颜色差异 + 椭圆先验生成主体 alpha mask，保留 ellipse fallback，并继续通过 structured analyzer result 写回 current extraction。
50. 新增 Worker refined clean plate seam：Worker heuristic clean plate 优先走可替换 refined clean plate seam，默认实现用 refined mask + 主体框周边采样做近似修补，并保留 approximate fallback。
51. 新增 Worker text candidate extractor seam：Worker heuristic 可通过可选 extractor 把标题 crop 投影为 structured `TextLayer` 候选；无结果或失败时继续回退 raster 候选。
52. 新增 Worker TextLayer runtime roundtrip 回归：`installLayeredDesignStructuredAnalyzerWorkerRuntime` 可执行带 text extractor 的 Worker heuristic provider，并把 `TextLayer` structured result 回传主线程。
53. 新增 Worker Logo candidate refiner seam：Worker heuristic 可通过可选 refiner 把 Logo crop 替换为 refined logo image/mask structured result；无结果或失败时继续回退 raster Logo 裁片。
54. 新增 Worker background fragment refiner seam：Worker heuristic 可通过可选 refiner 把背景碎片 crop 替换为 refined effect image/mask structured result；无结果或失败时继续回退 raster 背景碎片裁片。
55. 新增 Worker refined seams DEV smoke fixture：`/design-canvas-smoke?analyzer=worker-refined` 会走 in-memory Worker runtime fixture，把 P5J TextLayer / Logo / 背景碎片 refined seams 注入同一 `AnalyzeLayeredDesignFlatImage`，并让 `smoke:design-canvas -- --analyzer worker-refined` 可观测 `WORKER REFINED TEXT`。
56. 新增 Worker subject mask refiner seam：Worker heuristic 可通过 provider-level `subjectMaskRefiner(...)` 把主体 raw crop 替换为 matting image/mask structured candidate；无结果或失败时继续回退 P5J refined subject mask / ellipse fallback。
57. 新增 Worker subject mask runtime roundtrip 回归：`installLayeredDesignStructuredAnalyzerWorkerRuntime` 可执行带 `subjectMaskRefiner` 的 Worker heuristic provider，并把 subject image/mask structured result 回传主线程。
58. 新增 Worker subject matting DEV smoke fixture：`/design-canvas-smoke?analyzer=worker-refined` 会把 `subjectMaskRefiner` 一并装入 in-memory Worker runtime fixture，并让 `smoke:design-canvas -- --analyzer worker-refined` 通过“主体候选 93% 置信度”可观测 subject matting seam。
59. 新增 subject matting provider adapter：`src/lib/layered-design/subjectMatting.ts` 定义最小 `LayeredDesignSubjectMattingProvider` / input / result，并把 `matteSubject(...)` 包装成 `subjectMaskRefiner`，后续真实 matting worker 不需要直接耦合 Worker heuristic provider。
60. 新增 deterministic subject matting provider：`createLayeredDesignDeterministicSubjectMattingProvider(...)` 用主体 crop + 1x1 不透明白色 PNG mask 作为本地占位执行源，帮助后续 smoke / adapter 先走真实 provider 形态，但不宣称真实 matting。
61. 新增 deterministic subject matting smoke 接入：`worker-refined` DEV smoke 的 subject matting seam 现在复用 P5L-5 deterministic provider + P5L-4 adapter，不再手写 subject fixture，GUI smoke 仍通过“主体候选 93% 置信度”观测该 seam。
62. 新增 subject matting Worker protocol：`src/lib/layered-design/subjectMattingWorker.ts` 定义 subject matting request/result/error、主线程 provider 包装与 Worker runtime 安装点，后续真实 matting Worker 只需实现 `LayeredDesignSubjectMattingProvider`。
63. 新增 subject matting browser Worker factory：`src/lib/layered-design/subjectMatting.worker.ts` 安装 deterministic provider runtime，`src/lib/layered-design/subjectMattingWorkerClient.ts` 提供可实例化 module Worker handle、fallback 与释放闭环。
64. 新增 subject matting Worker smoke 模式：`/design-canvas-smoke?analyzer=worker-matting` 会让 GUI 上传拆层路径穿过 subject matting Worker provider、P5L-4 adapter 与 `subjectMaskRefiner`，并用 94% 主体置信度观测该 seam。
65. 新增简单 subject matting Worker 算法占位：`subjectMatting.worker.ts` 默认从 deterministic provider 前进到边缘背景采样 + 色差 alpha + 椭圆先验的像素级 matted image / mask 生成。
66. 新增 Worker OCR provider adapter：`src/lib/layered-design/textOcr.ts` 可把现有 `LayeredDesignFlatImageTextOcrProvider` 包装成 Worker heuristic `textCandidateExtractor`，并提供 deterministic OCR provider 取代 `worker-refined` 手写文本 fixture。
67. 新增 OCR Worker protocol：`src/lib/layered-design/textOcrWorker.ts` 定义 text OCR request/result/error、主线程 OCR provider 包装与 Worker runtime 安装点，后续真实 OCR Worker 只需实现 `LayeredDesignFlatImageTextOcrProvider`。
68. 新增 OCR browser Worker factory：`src/lib/layered-design/textOcr.worker.ts` 安装 deterministic OCR provider runtime，`src/lib/layered-design/textOcrWorkerClient.ts` 提供可实例化 module Worker handle、fallback 与释放闭环。
69. 新增 OCR Worker smoke 模式：`/design-canvas-smoke?analyzer=worker-ocr` 会让 GUI 上传拆层路径穿过 OCR Worker provider、P5M-1 adapter 与 `textCandidateExtractor`，并用 `WORKER OCR TEXT` 观测该 seam。
70. 新增 OCR provider priority 组合器：`textOcr.ts` 统一封装 native / browser / Worker OCR provider 的失败跳过、空文本跳过与首个有效结果返回，默认 analyzer 复用该 helper 保留实际命中的 provider label。
71. 新增 OCR priority smoke 模式：`/design-canvas-smoke?analyzer=worker-ocr-priority` 会让 GUI 上传拆层路径穿过 priority OCR provider、OCR Worker provider、P5M-1 adapter 与 `textCandidateExtractor`，并用 `WORKER OCR TEXT` 观测该组合 seam。
72. 新增 clean plate provider seam：`cleanPlate.ts` 定义 `LayeredDesignCleanPlateProvider`，Worker heuristic 可优先走 provider 输出背景修补资产，失败时回退现有 refined / approximate clean plate。
73. 新增 clean plate 风险提示 UI：拆层确认态会显示背景修补来源、成功/失败风险和移动主体后的核对提示，避免用户把 heuristic/provider clean plate 误认为无风险真 inpaint。
74. 新增原生分层工程 roundtrip smoke：`smoke:design-canvas -- --project-roundtrip` 会在上传拆层前验证 prompt seed `LayeredDesignDocument` 的图层交互、工程目录保存、重新打开和恢复后继续编辑，固定原生分层设计工程主链。
75. 已把原生分层工程 roundtrip 升级为 `smoke:design-canvas` 默认门槛：默认 smoke 会先保存/打开/恢复，再继续上传拆层；只有显式 `--skip-project-roundtrip` 才跳过持久化链路。
76. 新增简单像素级 clean plate Worker provider：默认 structured analyzer Worker 现在会通过 clean plate provider seam 读取原图与主体 mask，用邻域像素修补主体原位置，并把 provider 元数据写回 `LayeredDesignDocument.extraction.cleanPlate`。
77. 新增 clean plate 专用 Worker protocol 与 browser factory：真实 inpaint / clean plate 执行源后续只需实现 `LayeredDesignCleanPlateProvider.createCleanPlate(...)`，即可穿过 request/result/error 边界并回到现有 `cleanPlateRefiner` seam。
78. 新增 clean plate Worker GUI smoke 可观测模式：`/design-canvas-smoke?analyzer=worker-clean-plate` 会让 current GUI 上传拆层路径穿过 clean plate browser Worker provider，并在确认态观测 provider / model 来源。

仍未做：

1. 不新增 provider adapter、旧 poster 命令或平行主链；P4F/P4G 只新增 current 工程目录保存/读取命令。
2. 不直接调用 `gpt-image-2` / Gemini / Flux；当前只规范 request contract 与现有 media task artifact 写回。
3. 不引入 Fabric 运行时。
4. 不宣称 PSD 试点 writer 已经等同于完整 PSD 互操作、像素级图层还原或 Photoshop/Figma 完整可编辑文件；当前 PSD 只保证可打开、可看到图层列表、顺序、可见性和占位像素。PSD 文件打开验证、生产级复杂 matting、inpaint、跨平台 native OCR 完整覆盖或拆层模型执行仍未完成。
5. 不宣称原生工程目录落盘、PSD-like manifest、PSD 试点文件或 `LayeredDesignDocument.extraction` 已经等同于完整真 PSD、mask、inpaint、OCR 或完整扁平图拆层产品流；这些仍在后续 P4/P5。
6. 不宣称已完成复杂 matting、模型级 mask refine、文字/Logo 自动拆层、独立拆层确认页或 provider 级 clean plate / inpaint 生成；当前只是把后续执行结果所需的 current 事实源协议、本地 heuristic 候选层、统一 analyzer seam 与 current Canvas 确认态先落稳。
7. 不宣称当前“对照预览”已经等同于专业 mask / matting 质检页；现在看到的只是 `LayeredDesignDocument.extraction` 已有 source / candidate / clean plate 资产的查看投影。
8. 不宣称 `extraction.analysis.outputs` 已经等同于真实模型能力探测；当前它只是本轮 analyzer 实际返回结果的 current 快照，先服务协议收口和 UI 风险显式化。
9. 不宣称可注入 structured analyzer provider / analyzer adapter / provider fallback / worker bridge / worker runtime handler / Worker local heuristic analyzer / 浏览器 Worker analyzer factory / DEV smoke 注入 / Tauri native command bridge 已经等同于真实模型执行；P5A-P5N-1 只钉住“真实结果如何进入 current 事实源、如何被 UI 消费、失败时如何保住 current 上传拆层主路径、如何从前端 Worker 边界往返、如何在 Worker 内执行本地 heuristic、如何实例化为 current analyzer、如何被受控 GUI 主路径消费、如何经 Tauri current 命令桥接回同一 structured result、如何替换 Worker refined subject mask、clean plate、TextLayer、Logo、背景碎片候选与 provider-level subject matting 候选、如何证明 TextLayer 与 subject mask 可穿过 Worker runtime 回传、如何让 refined seams 和 subject matting seam 被 GUI smoke 可观测、如何把真实 matting provider 包装回 subjectMaskRefiner、如何用 deterministic provider 占位真实算法前的 provider 形态并接入 smoke、如何让 subject matting provider 穿过专用 Worker protocol、如何实例化为 browser Worker handle 并保持 fallback / terminate 闭环、如何让 GUI smoke 真实消费该 Worker matting seam、如何把 OCR provider 包装成 Worker text extractor 并写回 TextLayer、如何让 OCR provider 穿过专用 Worker protocol、如何实例化为 OCR browser Worker handle 并保持 fallback / terminate 闭环、如何让 GUI smoke 真实消费 OCR Worker seam、如何把 native / browser / Worker OCR priority 收口为同一 provider helper 并保留命中来源、如何让 GUI smoke 真实消费 OCR priority + Worker OCR 组合 seam、如何用简单像素算法在 Worker 里产出 matted image / mask”的替换 seam，具体 VLM / OCR / 生产级 matting / inpaint worker 算法实现仍是后续项。

## 阶段计划

### P0：文档与边界

状态：已完成 proposal 文档，进入 implementation 跟踪。

产物：

1. `docs/research/ai-layered-design/`
2. `docs/roadmap/ai-layered-design/`
3. `docs/roadmap/skill-forge/` 与 AI 图层化设计边界说明

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

状态：P4A 设计工程导出首刀已完成，P4B 浏览器 ZIP 工程包已完成，P4C media task worker 后处理 seam 已完成，P4D data URL PNG 像素级 chroma-key 后处理已完成，P4E http/https 远程 URL PNG 后处理已完成，P4F 原生工程目录落盘已完成，P4G 工程目录再打开/恢复已完成，P4H PSD-like 专业导出投影首刀已完成，P4H-2 PSD 试点 writer 首刀已完成，P4I 原生工程目录远程资产持久化缓存已完成，P4J 扁平图拆层协议首刀已完成，P4K 扁平图 draft `canvas:design` artifact bridge 已完成，P4L 上传扁平图本地 draft adapter 已完成，P4M DesignCanvas 候选层切换首刀已完成，P4N 上传扁平图本地 heuristic seed 首刀已完成，P4O DesignCanvas 拆层确认态接线首刀已完成，P4P 扁平图 analyzer seam 与重新拆层入口已完成，P4Q DesignCanvas 拆层确认对照预览首刀已完成，P4R analyzer result metadata 首刀已完成，P4S 确认态 mask / OCR TextLayer 预览已完成，P4T structured analyzer result adapter 已完成，P4U 本地 heuristic mask / clean plate 真执行首刀已完成，P4V feature-detected OCR TextLayer 来源接入首刀已完成，P4W 可注入 OCR provider 来源接线已完成，P4X 原生 OCR provider bridge 首刀已完成，P4Y native OCR fallback/priority 回归闭环已完成，P4Z DesignCanvas 上传拆层 GUI smoke 已完成；完整 PSD 打开验证、复杂 matting / mask refine、完整跨平台 native OCR 与拆层模型执行链路仍未完成。

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
18. P4O 继续在同一条 current `DesignCanvas` 主路径补确认态接线：新增 `extraction.review.pending/confirmed`，让上传扁平图后必须先确认候选层、或显式选择“仅保留原图”进入图层编辑；确认态继续停留在 current Canvas 壳内，不另开平行页面或协议。
19. P4P 继续把上传与重跑拆层收口到同一个 analyzer adapter：`DesignCanvas` 不再直接依赖 heuristic helper，而是统一通过 `AnalyzeLayeredDesignFlatImage` seam 创建 / 刷新 `LayeredDesignDocument.extraction`，为后续真实 analyzer 执行链路留 current 接口。
20. P4Q 继续在 current `DesignCanvas` 确认态补 source / candidate / clean plate 对照预览：预览只读取当前事实源里的已有资产，不新开独立 viewer，也不把 local heuristic 假装成真实 mask / matting 结果。
21. P4R 继续把 analyzer 执行结果的 current 元数据收口进 `LayeredDesignDocument.extraction.analysis`：先记录 analyzer 名称、生成时间和输出能力快照，让 current UI 可以显式区分“当前有候选裁片 / 有没有 mask / 有没有 clean plate / 有没有 OCR text”，为后续真实 analyzer 结果进入同一份事实源铺路。
22. P4S 继续让确认态真实消费 `candidateMask / ocrText` 输出：mask 用 current 候选资产预览，OCR 文本候选用 `TextLayer` 投影预览，不新增独立 viewer。
23. P4T 先定义 structured analyzer result adapter，让真实 analyzer 可以用 image/mask/text/clean plate 结构化结果进入 current extraction seam，而不是直接手拼最终文档。
24. P4U 让默认 local heuristic analyzer 先产出真实 subject mask、带 alpha 主体候选和近似 clean plate，为后续替换成真实 matting / inpaint 执行源保留同一协议。
25. P4V 在宿主具备浏览器 `TextDetector` 时把标题裁片升级为可编辑 `TextLayer`；能力不可用时保留 `text_raster` fallback，不伪造 OCR。
26. P4W 把 OCR 来源抽成可注入 provider，调用方可把 native、worker 或真实 analyzer OCR 结果接到同一 structured adapter。
27. P4X 把默认 OCR provider 接到 current Tauri 命令 `recognize_layered_design_text`：macOS 首刀使用 Vision，非 macOS / 非 data URL 返回 unsupported 并让 analyzer 继续 fallback，不新增 provider adapter 或旧 poster 路线。
28. P4Y 固定 P4X 的 fallback/priority 行为：native OCR unsupported 时必须继续尝试 `TextDetector`，native OCR 有文本时必须优先写入原生结果，避免浏览器 OCR 覆盖 native 识别。
29. P4Z 把 `smoke:design-canvas` 从“打开 prompt seed 画布”升级为“打开画布 -> 上传扁平图 -> analyzer 生成 extraction draft -> 拆层确认 -> 进入图层编辑”的真实 GUI 闭环；仍复用 current `DesignCanvas`，不新开拆层页面或旧 image viewer。

### P5：真实 analyzer 执行源替换

状态：P5A 可注入 structured analyzer provider seam 已完成，P5B structured provider -> `AnalyzeLayeredDesignFlatImage` adapter 已完成，P5C provider 失败回退本地 heuristic 已完成，P5D 前端 worker structured analyzer bridge 已完成，P5E worker runtime handler 已完成，P5F Worker local heuristic analyzer 已完成，P5G 可实例化浏览器 Worker analyzer 已完成，P5H DesignCanvas smoke Worker analyzer 注入已完成，P5I Tauri native structured analyzer command bridge 已完成，P5J-1 Worker refined subject mask seam 已完成，P5J-2 Worker refined clean plate seam 已完成，P5J-3 Worker text candidate extractor seam 已完成，P5J-4 Worker TextLayer runtime roundtrip 回归已完成，P5J-5 Worker Logo candidate refiner seam 已完成，P5J-6 Worker background fragment refiner seam 已完成，P5K-1 Worker refined seams DEV smoke fixture 已完成，P5L-1 Worker subject mask refiner seam 已完成，P5L-2 Worker subject mask runtime roundtrip 回归已完成，P5L-3 Worker subject matting DEV smoke fixture 已完成，P5L-4 subject matting provider adapter 已完成，P5L-5 deterministic subject matting provider 已完成，P5L-6 deterministic subject matting smoke 接入已完成，P5L-7 subject matting Worker protocol 已完成，P5L-8 subject matting browser Worker factory 已完成，P5L-9 subject matting Worker smoke 模式已完成，P5M-1 Worker OCR provider adapter 已完成，P5M-2 OCR Worker protocol 已完成，P5M-3 OCR browser Worker factory 已完成，P5M-4 OCR Worker smoke 模式已完成，P5M-5 OCR provider priority 组合器已完成，P5M-6 OCR priority smoke 模式已完成，P5N-1 简单 subject matting Worker 算法占位已完成，P5O-1 clean plate provider seam 已完成，P5O-3 clean plate 风险提示 UI 已完成，P5P-1 原生分层工程 roundtrip smoke 已完成，P5P-2 roundtrip 默认 smoke 门槛已完成，P5Q-1 简单像素级 clean plate Worker provider 已完成，P5Q-2 clean plate Worker protocol / browser factory 已完成，P5Q-3 clean plate Worker GUI smoke 可观测模式已完成；真实 VLM / OCR / clean plate worker 与生产级 matting 模型实现仍未开始。

计划：

1. P5A 先让 `analyzeLayeredDesignFlatImage` 接收可注入 structured analyzer provider：外部执行源返回 image / mask / text / clean plate 结构化结果后，继续复用 `createLayeredDesignFlatImageAnalysisResultFromStructuredResult` 投影到 current `LayeredDesignDocument.extraction`。
2. P5B 先把 provider seam 包装成 `AnalyzeLayeredDesignFlatImage` adapter，保证 `DesignCanvas`、smoke、测试和后续执行桥接都继续消费同一个 analyzer 接口。
3. P5C 先补 provider 可靠性闭环：真实 analyzer provider 暂不可用或抛错时默认回退 current 本地 heuristic；调试/严格模式可用 `fallbackAnalyzer: null` 保留原始错误，不把失败伪装成真实拆层完成。
4. P5D 先接前端 worker structured analyzer bridge：Worker 只返回 structured result，不携带不可 clone 的 OCR function；结果再由 P5A/P5B/P5C seam 写回 `LayeredDesignDocument.extraction`。
5. P5E 补 worker runtime handler：真实 Worker 内部安装 structured provider 后即可消费 P5D request 并回传 result/error，保持同一 structured result 协议。
6. P5F 先提供 Worker local heuristic analyzer：在 Worker 内用 OffscreenCanvas 执行候选裁片、主体椭圆 mask 与近似 clean plate，证明 P5D/P5E 双侧 bridge 能承载真实像素执行。
7. P5G 把 Worker bridge 实例化成可直接注入的浏览器 Worker analyzer：创建 module Worker、组合 structured provider、adapter 与 fallback，并确保每次分析后释放 Worker。
8. P5H 把 Worker analyzer 接进 DEV-only DesignCanvas smoke：通过 query 显式启用 Worker analyzer，跑真实上传拆层 GUI 闭环，但不改变默认产品路径。
9. P5I 接 Tauri current 命令 bridge：`analyze_layered_design_flat_image` 只返回 structured result，经 provider seam / analyzer adapter 投影回 `LayeredDesignDocument.extraction`；不新增旧 poster 命令、provider adapter 或平行拆层 artifact。
10. P5J 逐步替换 local heuristic 的具体能力：P5J-1 先让 Worker heuristic 优先使用 refined subject mask seam，P5J-2 再让 clean plate 优先走 refined clean plate seam，P5J-3 补 Worker text candidate extractor seam，P5J-4 固定 TextLayer structured result 可穿过 Worker runtime 回传，P5J-5 补 Worker Logo candidate refiner seam，P5J-6 补 Worker background fragment refiner seam；后续继续接真实主体 matting、真实 OCR、provider/worker clean plate / inpaint、背景语义候选；每一步都必须写回 `extraction.analysis.outputs`，让确认态显式展示结果边界。
11. P5K 做 DEV smoke 能力矩阵、跨平台能力补齐与 GUI 验证：P5K-1 先把 P5J refined seams 做成 opt-in Worker fixture 并接入 DesignCanvas smoke；后续 macOS / Windows / Linux 能力不可用时要清楚 fallback，不把失败伪装成真实拆层完成。
12. P5L 继续把真实 matting / segmentation worker 的替换点前移：P5L-1 先新增 provider-level `subjectMaskRefiner(...)`，让真实主体分割只需返回 subject image/mask structured result，不必覆盖整个 rasterizerFactory 或打开平行 analyzer；P5L-2 固定该 subject image/mask structured result 可穿过 Worker runtime request/response 边界；P5L-3 把该 seam 接进 DEV-only `worker-refined` smoke fixture，让 GUI smoke 能观测主体 matting seam；P5L-4 定义最小 subject matting provider adapter，让真实 matting worker 只实现 `matteSubject(...)` 即可回到 current extraction；P5L-5 提供 deterministic local provider 作为真实算法前的 provider 形态占位；P5L-6 把 deterministic provider 接进 `worker-refined` smoke，减少手写 fixture；P5L-7 定义 subject matting 专用 Worker protocol 与 runtime 安装点，但不引模型依赖；P5L-8 新增可实例化 browser Worker factory 与 module Worker 空壳，先只安装 deterministic provider，并保持 fallback / terminate 闭环；P5L-9 把该 Worker provider 接进 DEV-only `worker-matting` smoke 模式，证明 GUI 上传拆层路径能消费 subject matting Worker seam。
13. P5M 开始把 OCR 替换点前移：P5M-1 先把现有 `LayeredDesignFlatImageTextOcrProvider` 包装成 Worker heuristic `textCandidateExtractor`，让 Worker TextLayer 不再依赖手写 fixture；P5M-2 定义 OCR 专用 Worker protocol 与 runtime 安装点，让 OCR provider 能穿过 request/result 边界；P5M-3 新增可实例化 OCR browser Worker factory 与 module Worker 空壳，先只安装 deterministic OCR provider，并保持 fallback / terminate 闭环；P5M-4 把该 Worker provider 接进 DEV-only `worker-ocr` smoke 模式，证明 GUI 上传拆层路径能消费 OCR Worker seam；P5M-5 把 native / browser / Worker OCR priority 收口为可组合 provider seam，并让默认 analyzer 复用同一 priority helper 保留命中来源；P5M-6 把 priority provider 接进 DEV-only `worker-ocr-priority` smoke，证明 GUI 上传拆层路径能消费该组合 seam。
14. P5N 开始把 subject matting 从 deterministic provider 推进到简单像素算法：P5N-1 先在 Worker provider 内执行边缘背景采样、色差 alpha 与椭圆先验，输出 matted image / mask，并继续通过 P5L subject matting seam 回到 current `LayeredDesignDocument.extraction`。
15. P5O 回到“移动图层不露洞”的主线：P5O-1 先定义 clean plate / inpaint provider seam，让真实背景修补源只需输出 clean plate asset，即可通过 Worker heuristic structured analyzer 写回 current extraction；provider 失败时继续回退现有 heuristic clean plate。P5O-3 再把 clean plate 来源与失败风险显示在拆层确认态，让用户进入编辑前知道移动主体是否可能露洞。
16. P5P 回到原生分层设计工程主线：P5P-1 先扩展 DesignCanvas 专属 GUI smoke，在上传拆层前固定 prompt seed -> 图层交互 -> 工程目录保存 -> 打开最近工程 -> 恢复后继续编辑，再继续原有上传拆层闭环；P5P-2 把该 roundtrip 设为 `smoke:design-canvas` 默认门槛，避免后续 GUI smoke 只验证非持久化半链路。
17. P5Q 回到“移动主体后不露洞”的产品主线：P5Q-1 先把 clean plate provider 从 deterministic 占位推进到简单像素级邻域修补，并接入默认 structured analyzer Worker；P5Q-2 补 clean plate 专用 Worker protocol、module Worker 与 browser client factory；P5Q-3 把 clean plate Worker provider 接进 DEV-only DesignCanvas smoke 可观测模式，后续再替换成模型级 inpaint / clean plate provider。

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
32. 拆层确认态必须继续挂在 `LayeredDesignDocument.extraction.review` 上；确认后进入的仍是同一份 `canvas:design` 文档和 `DesignCanvas`，不能为“确认前/确认后”再开第二套事实源或 viewer。
33. 上传扁平图与“重新拆层”必须共用同一条 `AnalyzeLayeredDesignFlatImage` seam；默认 local heuristic 只是当前实现，不能让 UI 再直接反向依赖某个具体 seed helper。
34. 确认态的 source / candidate / clean plate 对照预览只是当前事实源资产的查看投影；预览层不能演化成新的 artifact、viewer 或平行设计协议。
35. analyzer 结果元数据也必须继续挂在 `LayeredDesignDocument.extraction` 下；不能为“分析结果摘要”再新增旁路 schema、事件缓存或第二套确认态状态源。
36. structured analyzer provider 只能返回 image / mask / text / clean plate 结构化结果；最终仍必须通过 `createLayeredDesignFlatImageAnalysisResultFromStructuredResult` 投影回 current `LayeredDesignDocument.extraction`。
37. structured provider -> analyzer adapter 只能包装成现有 `AnalyzeLayeredDesignFlatImage` 接口供 `DesignCanvas` 消费，不能让 UI 直接感知 provider 细节或新增拆层专用 artifact。
38. provider fallback 必须默认保护 current 上传拆层路径：provider 抛错时回退本地 heuristic；只有显式传 `fallbackAnalyzer: null` 时才把原始错误透出给严格执行/调试场景。
39. 前端 worker bridge 只能跨线程传递可 clone 的 image / createdAt / structured result；`textOcrProvider` 这类函数型本地能力不能穿过 Worker message 边界，避免把 UI 回调泄漏进执行线程协议。
40. worker runtime handler 只能消费同一套 structured analyzer request，并只回传 result/error；Worker 内部 provider 不能绕过 `LayeredDesignDocument.extraction` 投影协议直接生成 UI 状态。
41. Worker local heuristic analyzer 只能作为可替换的本地像素执行源：它可以生成 crop / refined mask / refined clean plate / 可选 TextLayer structured result，但不能宣称等同于真实 matting、OCR、inpaint 或模型拆层；refined subject mask、refined clean plate 与 text candidate extractor 都只能作为 P5J 的工程 seam 首刀，必须保留 fallback。
42. 浏览器 Worker analyzer factory 只能把 worker 输出重新包装成现有 `AnalyzeLayeredDesignFlatImage`，并在每次分析后释放 Worker；它不能成为第二套 UI 状态或绕过 P5C fallback。
43. DEV-only smoke 的 Worker analyzer 注入必须显式 opt-in，默认 `DesignCanvas` 产品路径仍使用 current 默认 analyzer；验证 Worker 入口不能演化成平行拆层页面。
44. Tauri native structured analyzer command 只能服务 current `LayeredDesignDocument.extraction`：前端必须经 `src/lib/api/layeredDesignAnalysis.ts` / structured provider seam 调用，Rust / DevBridge / catalog / mock 必须同步；unsupported 只能触发 fallback，不能绕回旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不能被当成 provider adapter。
45. Worker text candidate extractor 只能把已有标题 crop 转成 structured `TextLayer` 候选；extractor 无结果或抛错时必须回退 raster 候选，不能让 OCR seam 失败阻断 Worker analyzer。
46. Worker TextLayer runtime roundtrip 只能证明 structured `TextLayer` 可以穿过 worker runtime 回传；它不是 OCR 准确率验证，也不能被宣称为真实文字识别能力。
47. Worker Logo candidate refiner 只能把已有 Logo crop 替换成 structured image/mask 候选；refiner 无结果或抛错时必须回退原 Logo 裁片，不能宣称已完成真实 Logo 检测或分割。
48. Worker background fragment refiner 只能把已有背景碎片 crop 替换成 structured effect image/mask 候选；refiner 无结果或抛错时必须回退原背景碎片裁片，不能宣称已完成真实背景语义拆分。
49. Worker refined seams smoke fixture 只能作为 DEV-only opt-in 验证入口；它证明 P5J seams 可经 Worker runtime / analyzer adapter 被 `DesignCanvas` 消费，不能改变默认产品 analyzer，也不能宣称 fixture 文本等同真实 OCR。
50. Worker subject mask refiner 只能把已有主体 raw crop 替换为 structured image/mask 候选；refiner 无结果或抛错时必须回退 P5J refined subject mask / ellipse fallback，不能让真实 matting seam 失败阻断 current 上传拆层路径。
51. 原生分层工程 roundtrip smoke 必须先验证 prompt seed 文档的保存/打开/恢复后编辑能力，再进入上传拆层验证；工程目录 mock 也必须保留同一轮保存的 `design.json`，不能用静态 mock 文档掩盖恢复链路。
52. `smoke:design-canvas` 默认必须覆盖工程保存/打开/恢复；若临时排查非持久化链路，才允许显式使用 `--skip-project-roundtrip`。
53. 简单 clean plate provider 只能宣称“像素级邻域修补”，不能宣称真 inpaint；输出必须带 `simple_neighbor_inpaint_v1`、填充像素数和 mask 使用状态，供确认态继续提示人工核对风险。
54. clean plate Worker protocol 只能传递可 clone 的 `LayeredDesignCleanPlateInput` 与 `LayeredDesignCleanPlateResult | null`；真实模型 worker 不能绕过 `LayeredDesignDocument.extraction` 或直接生成 UI 状态。
55. clean plate Worker smoke 只能作为 DEV-only opt-in 可观测入口；默认产品路径仍消费 current Worker analyzer，真实 provider 命中必须通过确认态 `背景修补来源` 和 provider metadata 被观察到。

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

后续继续改 Tauri 命令 / provider / mock 时再追加：

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

### 2026-05-06 P4O DesignCanvas 拆层确认态接线首刀

- 已在 `src/lib/layered-design/types.ts`、`src/lib/layered-design/document.ts` 与 `src/lib/layered-design/extraction.ts` 补上 `LayeredDesignDocument.extraction.review` 的 `pending/confirmed` 状态，以及 `confirmLayeredDesignExtraction(...)` 纯函数；拆层确认不再只是瞬时 UI 状态，而是继续写回 current 事实源。
- 已在 `src/components/workspace/design/DesignCanvas.tsx` 把确认态接进当前工作台：上传扁平图后，属性栏会先进入“拆层确认”面板，展示原图预览、候选层列表、clean plate 状态，以及“进入图层编辑 / 仅保留原图 / 恢复默认候选”动作；确认前不会开放图层生图入口。
- 这一刀仍然没有新开独立确认页，而是把确认态保持在 current `DesignCanvas` 壳内：用户确认后只是把 `extraction.review` 从 `pending` 切到 `confirmed`，再继续编辑同一份 `LayeredDesignDocument`。
- 这刀的直接收益是：`上传扁平图 -> heuristic/extraction draft -> 候选选择 -> 确认进入图层编辑` 现在已经是一条可持久化、可恢复、可测试的 current 主链，而不是依赖临时 UI 文案的弱状态。
- 已验证：
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts"`
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/extraction.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run verify:gui-smoke -- --timeout-ms 600000 --interval-ms 1000`

### 2026-05-06 P4P 扁平图 analyzer seam 与重新拆层入口

- 已新增 `src/lib/layered-design/analyzer.ts`，定义 `AnalyzeLayeredDesignFlatImage` 与 `analyzeLayeredDesignFlatImage(...)`；当前默认实现仍然只包一层 local heuristic，不引入新命令、新 provider adapter 或第二条拆层主链。
- `src/components/workspace/design/DesignCanvas.tsx` 的上传扁平图入口与确认态“重新拆层”动作现在统一走 `analyzeFlatImage` seam，而不是直接耦合 `flatImageHeuristics` helper；后续接真实 analyzer 时可以在同一 current `DesignCanvas` 接口内替换执行来源。
- 已在 `src/lib/layered-design/extraction.ts` 新增 `reanalyzeLayeredDesignExtraction(...)`：重新拆层会刷新 `extraction.candidates / cleanPlate`，把 `review.status` 重置回 `pending`，并记录 `editHistory.type = "extraction_reanalyzed"`，继续复用同一份 `LayeredDesignDocument`。
- 这刀的直接收益是：`上传扁平图 -> analyzer -> extraction draft -> 确认 -> 编辑` 与 `编辑中 -> 重新拆层 -> 再确认` 现在已经共用同一套 current 状态机；未来接远程 analyzer 时不需要再改 UI 主入口或回流旧 viewer。
- 已验证：
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts"`
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/workspace/design/types.ts" "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/extraction.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run verify:gui-smoke -- --timeout-ms 600000 --interval-ms 1000`

### 2026-05-06 P4Q DesignCanvas 拆层确认对照预览首刀

- 已在 `src/components/workspace/design/DesignCanvas.tsx` 的确认态补 `查看原图 / 查看当前候选 / 查看修补背景` 三种预览切换；预览继续只读取 `LayeredDesignDocument.extraction` 已存在的 source / candidate / clean plate 资产，不新开独立 viewer。
- 点击候选层时，当前候选预览会同步切到该候选；如果 clean plate 还未生成或失败，确认态会在同一块预览位直接暴露失败 / 未执行提示，而不是静默隐藏风险。
- 当前 local heuristic analyzer 还没有真实 mask 产物，所以这刀明确只做 source / candidate / clean plate 的对照查看，不把它伪装成 mask 质检页或 matting 产品能力。
- 这刀的直接收益是：用户在 current `DesignCanvas` 确认态里，已经能更清楚地判断“保留哪些候选层、clean plate 是否可信、是否需要重新拆层”，不必离开当前事实源或等待独立确认页。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx` 回归，覆盖原图 / 当前候选 / clean plate 的预览切换。
- 已验证：
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts"`
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/workspace/design/types.ts" "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/extraction.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run verify:gui-smoke -- --timeout-ms 600000 --interval-ms 1000`

### 2026-05-06 P4R analyzer result metadata 首刀

- 已在 `src/lib/layered-design/types.ts` 给 current 事实源补 `LayeredDesignDocument.extraction.analysis`，统一记录 analyzer 名称、生成时间，以及 `candidateRaster / candidateMask / cleanPlate / ocrText` 四类输出能力快照。
- 已在 `src/lib/layered-design/analyzer.ts` 把默认 local heuristic analyzer 的结果改成显式 `analysis + candidates + cleanPlate` 返回结构；上传扁平图和“重新拆层”现在都会把 analyzer result metadata 一并写回 current 文档。
- 已在 `src/lib/layered-design/document.ts`、`src/lib/layered-design/extraction.ts`、`src/lib/layered-design/flatImage.ts` 收口 normalization / draft 创建 / 重新拆层复制链路，确保 analyzer metadata 继续跟着同一份 `LayeredDesignDocument` 走，而不是停留在瞬时 UI 状态里。
- 已在 `src/components/workspace/design/DesignCanvas.tsx` 的确认态直接消费 `extraction.analysis`：展示当前 analyzer、raster 候选、mask、clean plate、OCR text 是否已提供，并让 source / candidate 预览提示不再硬编码某个具体 analyzer 行为。
- 这刀的直接收益是：后续真实 analyzer 真接入时，不需要先改 UI 语义或另起结果摘要协议；当前 `DesignCanvas` 已经能明确区分“有候选裁片但没有 mask / 没有 clean plate / 没有 OCR text”的状态，不再靠文案猜。
- 已补回归：
  - `src/lib/layered-design/extraction.test.ts` 覆盖 extraction analysis 的创建与重新拆层刷新
  - `src/lib/layered-design/flatImage.test.ts` 覆盖 flat image draft 透传 analyzer metadata
  - `src/lib/layered-design/artifact.test.ts` 覆盖 `canvas:design` Artifact 打开后仍保留 `extraction.analysis`
  - `src/components/workspace/design/DesignCanvas.test.tsx` 覆盖确认态展示 analyzer metadata 与重新拆层写回 analysis
- 已验证：
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.test.ts"`
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/components/workspace/design/types.ts" "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/extraction.ts" "src/lib/layered-design/extraction.test.ts" "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/flatImage.ts" "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/artifact.ts" "src/lib/layered-design/artifact.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 600000 --interval-ms 1000`
  - `npm run verify:gui-smoke -- --timeout-ms 600000 --interval-ms 1000` 本轮未拿到干净退出：`smoke:design-canvas`、`knowledge-gui` 等前置阶段已通过，但后续在无关的 `smoke:agent-runtime-tool-surface-page` 出现“托管 Chrome 会话丢失”环境噪音，并非本轮 `DesignCanvas` 主路径失败。

### 2026-05-06 P4S 确认态 mask / OCR TextLayer 预览收口

- 已在 `src/components/workspace/design/DesignCanvas.tsx` 的确认态对照预览补 `查看 mask`：继续只读取 current `LayeredDesignDocument.extraction`，优先从候选 `maskAssetId` 或候选关联 `mask` 资产渲染，不新增独立 viewer 或第二套拆层协议。
- 已把 `查看当前候选` 收口为“图片候选显示裁片，文字候选直接渲染真实 `TextLayer` 预览”：这让 OCR / analyzer 未来返回的文本候选，不需要先伪造 raster 资产，也能在 current `DesignCanvas` 确认态被真实消费。
- 已同步更新确认态提示文案：明确当前对照预览现在可以直接核对原图、候选、候选 mask 和 clean plate，但这仍不等于已经做了真实 matting / mask refine。
- 这刀的直接收益是：`extraction.analysis.outputs.candidateMask / ocrText` 不再只是“状态字”，current UI 已开始真实消费同一份事实源里随 analyzer 写回的 mask 资产和 `TextLayer` 候选，为后续真 analyzer 落地提供可见闭环。
- 已补回归：
  - `src/components/workspace/design/DesignCanvas.test.tsx` 覆盖确认态 `查看 mask` 预览
  - `src/components/workspace/design/DesignCanvas.test.tsx` 覆盖 OCR `TextLayer` 候选在确认态的真实图层预览
- 已验证：
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx"`
  - `npm exec -- eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 600000 --interval-ms 1000`
  - `npm run verify:gui-smoke -- --timeout-ms 600000 --interval-ms 1000`

### 2026-05-06 P4T structured analyzer result adapter

- 已在 `src/lib/layered-design/analyzer.ts` 增加 structured analyzer result adapter：future real analyzer 现在不必直接拼装 `LayeredDesignExtractionCandidateInput`，而是可以先返回更贴近执行链路的结构化结果，再统一投影到 current `LayeredDesignDocument.extraction`。
- 这层 adapter 明确支持三类真实结果投影：
  - 图像候选 `image + optional mask -> ImageLayer(alphaMode=mask|embedded)`
  - OCR 文案候选 `text -> TextLayer`
  - clean plate `asset/status/message -> extraction.cleanPlate`
- adapter 会同步生成 `analysis.outputs.candidateRaster / candidateMask / cleanPlate / ocrText`，避免未来真 analyzer 接入时又回退到手写布尔状态或平行中间协议。
- 已在 `src/lib/layered-design/types.ts` 给 analyzer kind 补 `structured_pipeline`，把“本地 heuristic”与“结构化真实拆层结果”明确区分开，但继续共用同一条 current seam。
- 这刀的直接收益是：后续无论真实结果来自 VLM/OCR、mask/matting 还是 clean plate 流水线，只要先收敛成 structured analyzer result，就能稳定进入当前 `LayeredDesignDocument -> canvas:design -> DesignCanvas` 主链，不需要改 UI 事实源，也不需要新增 Artifact 类型。
- 已补回归：
  - `src/lib/layered-design/analyzer.test.ts` 覆盖 structured analyzer result -> current extraction seam
  - `src/lib/layered-design/analyzer.test.ts` 覆盖 structured analyzer result 直接创建 flat image draft
  - `src/lib/layered-design/analyzer.test.ts` 覆盖 clean plate 失败时不把 outputs.cleanPlate 误标为可用
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts"`
  - `npm exec -- eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/index.ts" "src/lib/layered-design/types.ts" --max-warnings 0`
  - `npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-06 P4U 本地 heuristic mask / clean plate 真执行首刀

- 已继续沿 current `analyzeLayeredDesignFlatImage` seam 往前推：默认本地 heuristic analyzer 不再只回裁片 seed，而是先执行主体 mask 与近似 clean plate 生成，再统一走上一刀的 structured adapter 收口到 `LayeredDesignDocument.extraction`。
- 已在 `src/lib/layered-design/analyzer.ts` 增加本地执行链：
  - 基于主体候选 bbox 生成真实 `mask` 资产
  - 基于主体 crop + mask 生成带 alpha 的主体候选图
  - 基于原图 + mask 生成近似 clean plate
- 这条执行链仍然显式属于 `local_heuristic`，不伪装成 VLM / OCR / matting 模型；它的作用是让 current 主链先真正消费“执行后的 mask / clean plate 结果”，而不是继续停留在协议占位或手工 fixture。
- 当前仍未解决 OCR 真来源：标题候选仍然是 `text_raster` 图像候选，不把它冒充成可编辑 `TextLayer`。这一步只推进 mask / clean plate 真执行，不额外虚构文字识别能力。
- 这刀的直接收益是：用户走默认上传路径时，`DesignCanvas` 确认态已经可以看到 analyzer 真生成的 subject mask 和 clean plate，不必依赖测试夹具或外部注入结果才能验证这条主链。
- 已补回归：
  - `src/lib/layered-design/analyzer.test.ts` 覆盖默认本地 heuristic analyzer 通过 structured adapter 输出真实 mask 与近似 clean plate
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts"`
  - `npm exec -- eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/index.ts" "src/lib/layered-design/types.ts" --max-warnings 0`
  - `npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-06 P4V feature-detected OCR TextLayer 来源接入首刀

- 已继续沿 current `analyzeLayeredDesignFlatImage` 主链补“真实文本来源 -> TextLayer”接线：当宿主环境暴露浏览器 `TextDetector` 能力时，默认 analyzer 会对标题裁片执行真实文本检测，并把结果直接写成可编辑 `TextLayer`，而不是继续停留在 `text_raster` 占位图层。
- 这刀没有新增命令、provider adapter 或平行协议；文本检测结果仍然统一走 `createLayeredDesignFlatImageAnalysisResultFromStructuredResult(...)` 收口到 `LayeredDesignDocument.extraction`。
- 当前实现策略是严格 feature detection：
  - `TextDetector` 可用：标题候选升级为 `TextLayer`，`analysis.outputs.ocrText = true`
  - `TextDetector` 不可用或检测失败：保持现有 `text_raster` fallback，不伪造 OCR 结果
- 这意味着“真实 OCR TextLayer 来源”已经接到 current seam，但是否在具体宿主上可用，仍取决于对应 WebView / 浏览器是否提供 `TextDetector`。本轮未宣称 macOS `WKWebView` 或 Windows `WebView2` 已经稳定具备这项能力。
- 这刀的直接收益是：current 路线现在第一次具备“真实检测到文字时，默认上传路径就能直接生成可编辑 `TextLayer`”的能力；没有能力的宿主仍然退回到既有 `text_raster`，不把假文本写进事实源。
- 已补回归：
  - `src/lib/layered-design/analyzer.test.ts` 覆盖 `TextDetector` 可用时默认 analyzer 把标题候选升级为 `TextLayer`
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts"`
  - `npm exec -- eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/index.ts" "src/lib/layered-design/types.ts" --max-warnings 0`
  - `npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-06 P4W 可注入 OCR provider 来源接线

- 已把默认 analyzer 的文字识别来源从硬编码浏览器能力推进为可注入 `LayeredDesignFlatImageTextOcrProvider`：调用方可以传入 native、worker 或后续真实 analyzer 的 OCR 执行结果，默认路径仍在未注入时回退到浏览器 `TextDetector`。
- 注入 OCR provider 返回的 text blocks 会统一转换成 `LayeredDesignFlatImageStructuredTextCandidate`，再继续通过 structured adapter 写入 `LayeredDesignDocument.extraction`；`DesignCanvas` 与 artifact 主链不需要新增页面、命令或旧 poster 协议。
- analyzer metadata 会在命中注入来源时把 label 标成 `本地 heuristic analyzer + <OCR provider>`，让确认态能区分“本轮 OCR text 确实来自外部执行来源”，而不是继续猜测宿主 `TextDetector` 是否存在。
- 这刀仍不宣称已经实现跨平台 native OCR 引擎；它完成的是 current 主链可稳定接收外部 OCR 来源，下一刀可以把 Tauri native OCR、worker OCR 或真实 analyzer 执行源挂到同一个入口。
- 已补回归：
  - `src/lib/layered-design/analyzer.test.ts` 覆盖注入 OCR provider 时默认 analyzer 优先生成可编辑 `TextLayer`
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts"`
  - `npm exec -- eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" --max-warnings 0`
  - `npm exec -- tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-06 P4X 原生 OCR provider bridge 首刀

- 已新增 current 前端 API 网关 `src/lib/api/layeredDesignAnalysis.ts`，统一承接 `recognize_layered_design_text`，业务侧仍通过 `src/lib/layered-design/analyzer.ts` 的 OCR provider seam 调用，不在组件或 Hook 里散落裸 `invoke`。
- 默认 analyzer 的 OCR provider 顺序现在是 `Tauri native OCR -> 浏览器 TextDetector`；显式传入 `textOcrProvider` 时只使用调用方来源，传入 `textOcrProvider: null` 时禁用 OCR，provider 异常或无结果会继续尝试下一个来源，不让 OCR 失败中断拆层。
- 已在 `src-tauri/src/commands/layered_design_cmd.rs` 新增 `recognize_layered_design_text`：macOS 首刀使用 Vision `VNRecognizeTextRequest` 处理 `data:image/*;base64` 图片，并把 Vision 归一化 bbox 转为候选图像像素坐标。
- 命令安全边界保持最小：OCR 输入大小上限为 20 MiB；非 macOS、非 `data:` 来源或非图片来源返回 `supported=false`，不会把图片上传 / 拆层任务整体打失败；空宽高或无效 base64 才返回命令错误。
- 命令边界已同步四侧：Rust `runner.rs` 注册、DevBridge `files.rs` 分发、`agentCommandCatalog.json` catalog、`src/lib/tauri-mock/core.ts` 默认 mock 与 `core.test.ts`；mock 只返回 unsupported，不伪造识别文字。
- 这刀仍不新增 provider adapter、不接旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不把 native OCR 声称为完整跨平台 OCR；它只是把 P4W 的可注入来源接到 current Tauri 命令边界，后续 Windows / Linux OCR 或真实 analyzer 执行源继续复用同一 provider seam。
- 已补回归：
  - `src/lib/api/layeredDesignAnalysis.test.ts` 覆盖 API 网关参数包裹与返回值投影
  - `src/lib/layered-design/analyzer.test.ts` 覆盖 native OCR provider 输出映射与 analyzer 默认 OCR 来源接线
  - `src/lib/tauri-mock/core.test.ts` 覆盖 browser mock 可回退但不伪造文字
  - `src-tauri/src/commands/layered_design_cmd.rs` 覆盖 unsupported 来源与空宽高错误
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/api/layeredDesignAnalysis.test.ts" "src/lib/tauri-mock/core.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/api/layeredDesignAnalysis.ts" "src/lib/api/layeredDesignAnalysis.test.ts" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `CARGO_TARGET_DIR="/tmp/lime-layered-design-ocr-target" cargo test --manifest-path "src-tauri/Cargo.toml" recognize_layered_design_text --lib`
  - `npm run test:contracts`

### 2026-05-07 P4Y native OCR fallback/priority 回归闭环

- 已在 `src/lib/layered-design/analyzer.test.ts` 固定默认 OCR provider 链的两个关键行为：
  - native OCR 返回 `supported=false` 时，默认 analyzer 必须继续 fallback 到浏览器 `TextDetector`，并且仍能把标题候选升级为可编辑 `TextLayer`
  - native OCR 返回文本块时，默认 analyzer 必须优先使用 `Tauri native OCR` 结果，不能继续调用或覆盖为浏览器 `TextDetector` 结果
- 测试里显式 mock `recognizeLayeredDesignText` 默认返回 unsupported，让 P4X 的 fallback 行为不再依赖 `safeInvoke` 在 test 环境里的隐式 browser mock。
- 这刀不新增命令、不改 Rust 执行逻辑、不触碰 GUI 主路径；它收口的是 P4X 接入后的 current analyzer 行为契约，确保 native OCR 不可用不会破坏上传扁平图拆层路径。
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/api/layeredDesignAnalysis.test.ts" "src/lib/tauri-mock/core.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/api/layeredDesignAnalysis.ts" "src/lib/api/layeredDesignAnalysis.test.ts" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" --max-warnings 0`
  - 重建 `/tmp/lime-layered-design-tsconfig.json` 后执行 `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P4Z DesignCanvas 上传拆层 GUI smoke

- 已扩展 `scripts/design-canvas-smoke.mjs`：脚本现在会在真实 `/design-canvas-smoke` 页面完成“打开 `canvas:design` -> 选择/移动/显隐图层 -> 上传 PNG 扁平图 -> 等待 extraction draft / 拆层确认态 -> 点击进入图层编辑”的产品闭环。
- 上传测试图由脚本内置 PNG writer 生成，避免引入额外 fixture 文件或网络资源；它只作为 smoke 输入资产，不进入设计协议事实源。
- 这刀验证的是 current `LayeredDesignDocument -> canvas:design -> DesignCanvas -> analyzeLayeredDesignFlatImage -> extraction.review -> confirmed layers` GUI 主路径，没有新增拆层页面、旧 `ImageTaskViewer` 或 `canvas:poster` 路线。
- 已验证：
  - `./node_modules/.bin/eslint "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000` 通过，真实 DevBridge / 默认 workspace 下完成上传拆层确认闭环
- 额外尝试：
  - `npm run verify:gui-smoke -- --reuse-running --timeout-ms 600000 --interval-ms 1000` 未完整通过；`workspace-ready`、`browser-runtime`、`site-adapters`、`agent-service-skill-entry`、`agent-runtime-tool-surface` 与 `agent-runtime-tool-surface-page` 已通过，后续在无关 `smoke:knowledge-gui` 的“关闭文件管理器”控件定位处失败。该失败不属于本轮 `DesignCanvas` 主路径，但说明仓库级 GUI smoke 当前仍有知识库 GUI 旁路缺口待单独收口。

### 2026-05-07 P5A 可注入 structured analyzer provider seam

- 已在 `src/lib/layered-design/analyzer.ts` 新增 `LayeredDesignFlatImageStructuredAnalyzerProvider` 与 `structuredAnalyzerProvider` 参数：调用方可以直接提供真实 analyzer 结构化结果，默认未注入时仍走本地 heuristic。
- provider 返回的 image / mask / text / clean plate 会继续通过 `createLayeredDesignFlatImageAnalysisResultFromStructuredResult(...)` 写回 `LayeredDesignDocument.extraction`，不会绕开 current `canvas:design -> DesignCanvas` 主链，也不会新增旧 `poster_generate / canvas:poster / ImageTaskViewer` 路线。
- 这刀的直接收益是：后续 Tauri command、worker、VLM/OCR/matting/inpaint pipeline 都有一个明确替换点，不再需要 UI 直接依赖某个具体 analyzer helper，也不需要在真实执行源接入时重新设计 extraction schema。
- 这刀仍不宣称真实模型已接入；它只完成真实 analyzer 执行源替换的协议 seam。
- 已补回归：
  - `src/lib/layered-design/analyzer.test.ts` 覆盖注入 structured analyzer provider 时直接替换本地 heuristic 来源，并确保外部 OCR provider 不会被本地 heuristic 链误调用
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5B structured provider -> analyzer adapter

- 已在 `src/lib/layered-design/analyzer.ts` 新增 `createLayeredDesignFlatImageAnalyzerFromStructuredProvider(...)`，把 P5A 的 structured analyzer provider 包装成现有 `AnalyzeLayeredDesignFlatImage` 接口。
- 这个 adapter 让 `DesignCanvas`、测试、smoke 或后续 worker / Tauri command bridge 可以直接传入 `analyzeFlatImage`，而不需要 UI 了解 provider 细节，也不需要新增拆层专用页面或第二套 artifact。
- adapter 支持绑定默认 `textOcrProvider`，同时仍允许调用方在单次 `AnalyzeLayeredDesignFlatImageParams` 里覆盖 OCR 来源；结构化结果最终仍回到 `LayeredDesignDocument.extraction`。
- 这刀仍不新增 Tauri 命令，不引入真实模型执行；它只把真实执行源和 current UI 主路径之间的接口闭合。
- 已补回归：
  - `src/lib/layered-design/analyzer.test.ts` 覆盖 provider adapter 可作为 `AnalyzeLayeredDesignFlatImage` 使用，并把结构化 image 结果投影回 current candidate/layer/asset
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5C provider 失败回退本地 heuristic

- 已扩展 `createLayeredDesignFlatImageAnalyzerFromStructuredProvider(...)`：structured analyzer provider 抛错时默认回退到 current `analyzeLayeredDesignFlatImage` 本地 heuristic，避免真实执行源短暂不可用时直接打断上传拆层确认主路径。
- fallback 会显式把 `structuredAnalyzerProvider` 清空后再调用 fallback analyzer，避免同一个失败 provider 在回退链里被重复触发；`textOcrProvider` 仍按“调用参数优先，adapter 默认值兜底”的规则传递。
- 调试或严格执行场景可以传 `fallbackAnalyzer: null`，此时 adapter 保留 provider 原始错误，不会伪装成本地 heuristic 成功。
- 这刀不新增命令、不接真实模型、不改 GUI；它只补齐 P5A/P5B seam 的可靠性闭环，保证后续 worker / Tauri command bridge 接入前 current 上传拆层路径仍可用。
- 已补回归：
  - `src/lib/layered-design/analyzer.test.ts` 覆盖 provider 抛错默认回退本地 heuristic，并验证 `local_heuristic`、候选层与 clean plate 成功输出仍写回 current result。
  - `src/lib/layered-design/analyzer.test.ts` 覆盖 `fallbackAnalyzer: null` 时保留 provider 原始错误，方便后续真实执行源做严格失败面调试。
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5D 前端 worker structured analyzer bridge

- 已新增 `src/lib/layered-design/structuredAnalyzerWorker.ts`：定义前端 Worker message protocol，并提供 `createLayeredDesignStructuredAnalyzerWorkerProvider(...)`，把 Worker 执行源包装成 P5A 的 structured analyzer provider。
- Worker request 只跨线程传递 `image / createdAt`，不会发送 `textOcrProvider` 这类函数型本地能力；Worker response 只返回 structured result 或结构化错误，再继续由 P5B adapter 与 P5C fallback 进入 current analyzer 主链。
- 这刀没有新增 Tauri 命令、Rust 注册、DevBridge、mock 或旧 `poster_generate / canvas:poster / ImageTaskViewer` 路线；它只是先把真实 analyzer worker 的前端接入边界钉稳，真实 VLM / matting / inpaint worker 实现仍是后续。
- 已通过 `src/lib/layered-design/index.ts` 导出 worker bridge，让后续 `DesignCanvas.analyzeFlatImage` 注入、smoke 或真实 worker 可以直接复用同一 current seam。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 覆盖 Worker result -> structured provider、错误消息按 requestId 匹配、以及 Worker provider 继续通过 analyzer adapter 写回 current analysis result。
  - `src/lib/layered-design/analyzer.test.ts` 继续覆盖 P5C provider fallback 与 `fallbackAnalyzer: null` 严格失败面。
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5E worker runtime handler

- 已在 `src/lib/layered-design/structuredAnalyzerWorker.ts` 增加 `installLayeredDesignStructuredAnalyzerWorkerRuntime(...)`：真实 Worker 内部安装 structured provider 后，可以直接消费 P5D 的 request protocol，并把 structured result / error 回传给主线程 provider bridge。
- runtime handler 只接受 `lime.layered_design.structured_analyzer.request`，会忽略非 request 或形态不完整的消息；错误统一回传 `lime.layered_design.structured_analyzer.error`，让 P5C fallback 可以继续保护 current 上传拆层主路径。
- 这刀仍不新增 Tauri 命令、不接真实模型、不改 GUI；它把 worker 边界从“主线程调用壳”补成“主线程 provider + Worker runtime handler”双侧闭环，后续真实 VLM / matting / inpaint worker 只需要提供 structured provider。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 覆盖 runtime handler 执行 provider 并回传 result。
  - `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 覆盖 runtime handler 忽略无效消息，并在 provider 抛错时回传结构化 error。
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5F Worker local heuristic analyzer

- 已新增 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts`：提供 `createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider(...)`，Worker 内可用 OffscreenCanvas 执行候选裁片、主体椭圆 mask、近似 clean plate，并返回 P5A structured result。
- 已从 `src/lib/layered-design/flatImageHeuristics.ts` 导出纯几何候选规格 builder，让主线程本地 heuristic seed 与 Worker heuristic analyzer 复用同一套主体 / 标题 / Logo / 边角碎片 bbox 规则，避免两边各自硬编码比例。
- Worker heuristic 输出仍标记为 `local_heuristic`：它证明 P5D/P5E 的 Worker 双侧 bridge 能承载真实像素执行，但不宣称等同于真实 VLM、matting、OCR 或 inpaint 拆层模型。
- 已通过 `src/lib/layered-design/index.ts` 导出 Worker heuristic provider；后续可把它安装进真实 Worker runtime，或作为 `DesignCanvas.analyzeFlatImage` 的注入源继续走 P5B/P5C adapter。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 Worker heuristic provider 产出 structured image/mask/clean plate 结果，并确保 rasterizer 生命周期关闭。
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 Worker heuristic provider 通过 analyzer adapter 写回 current `analysis.outputs` 与 mask alphaMode。
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/structuredAnalyzerWorker.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5G 可实例化浏览器 Worker analyzer

- 已新增 `src/lib/layered-design/structuredAnalyzer.worker.ts`：真实 module Worker 入口会安装 P5E runtime handler，并绑定 P5F Worker local heuristic structured provider。
- 已新增 `src/lib/layered-design/structuredAnalyzerWorkerClient.ts`：提供 `createLayeredDesignWorkerHeuristicAnalyzer(...)`，前端可直接拿到 `AnalyzeLayeredDesignFlatImage`，内部组合真实 Worker、P5D worker provider、P5B analyzer adapter 与 P5C fallback。
- Worker analyzer 每次分析后都会调用 `terminate()` 释放 Worker，避免把拆层执行线程变成长驻隐藏状态；Worker 失败时仍走 adapter fallback，不会直接打断 current 上传拆层路径。
- 这刀仍不改 `DesignCanvas` 默认注入、不新增 Tauri 命令、不改 Bridge / mock；它先把“可注入真实 Worker analyzer”能力闭合，后续 GUI 接入可以只传 `analyzeFlatImage={createLayeredDesignWorkerHeuristicAnalyzer(...)}`。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts` 覆盖真实 Worker analyzer factory 发出 request、消费 result 并释放 Worker。
  - `src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts` 覆盖 Worker error 时走 fallback analyzer，并仍然释放 Worker。
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/structuredAnalyzer.worker.ts" "src/lib/layered-design/structuredAnalyzerWorker.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5H DesignCanvas smoke Worker analyzer 注入

- 已在 `src/components/workspace/canvas/CanvasFactory.tsx` 增加 `designAnalyzeFlatImage` 注入位，只向 `DesignCanvas.analyzeFlatImage` 透传，不影响 document/video canvas，也不新增 artifact 类型。
- 已在 DEV-only `src/pages/design-canvas-smoke.tsx` 支持 `?analyzer=worker`：显式启用 P5G `createLayeredDesignWorkerHeuristicAnalyzer(...)`，页面 badge 会标记 “Worker analyzer 已启用”。
- 已更新 `scripts/design-canvas-smoke.mjs`：专属 smoke 默认以 `analyzer=worker` 打开页面，并在上传扁平图后等待 `Worker local heuristic analyzer`，证明真实页面已消费 Worker analyzer 输出，而不是只跑默认本地 analyzer。
- 这刀仍不改变默认产品路径，不新增 Tauri 命令 / Bridge / mock，不触碰旧 `poster_generate / canvas:poster / ImageTaskViewer` 路线；Worker analyzer 只在受控 DEV smoke 入口显式 opt-in。
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/structuredAnalyzer.worker.ts" "src/lib/layered-design/structuredAnalyzerWorker.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/index.ts" "src/components/workspace/canvas/CanvasFactory.tsx" "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run tauri:dev:headless`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5I Tauri native structured analyzer command bridge

- 已新增 `src/lib/api/layeredDesignAnalysis.ts` 的 `analyzeLayeredDesignFlatImageNative(...)` 网关：前端只通过 `safeInvoke("analyze_layered_design_flat_image", { request })` 进入 native analyzer，不在 UI / Hook 中散落裸命令。
- 已在 `src/lib/layered-design/analyzer.ts` 增加 `createLayeredDesignNativeStructuredAnalyzerProvider(...)`：native 命令返回 `supported && result` 时直接进入 P5A structured result adapter；unsupported / no result 抛错交给 P5C fallback。
- 已在 `src-tauri/src/commands/layered_design_cmd.rs` 增加 `analyze_layered_design_flat_image` 首刀：仅支持 `data:image/png;base64`，用 Rust `image` 执行 native heuristic crop、ellipse mask、alpha subject 与近似 clean plate，并返回 `local_heuristic` structured result；非 PNG / 非 data URL 返回 `supported=false`，不让拆层任务整体失败。
- 命令边界已同步 current 五侧：前端 API 网关、Rust `generate_handler!` 注册、DevBridge dispatcher、`agentCommandCatalog`、`defaultMocks`；`docs/aiprompts/commands.md` 已记录它属于 `LayeredDesignDocument.extraction` 主链。
- 这刀仍不是真 VLM / matting / OCR / inpaint 模型，也不是 provider adapter；它只把 Tauri native 执行源接回同一 structured analyzer seam，避免后续真实执行源再开平行拆层协议。
- 已补回归：
  - `src/lib/api/layeredDesignAnalysis.test.ts` 覆盖新 API 网关命令名与 nested `request`。
  - `src/lib/layered-design/analyzer.test.ts` 覆盖 native provider 成功代理和 unsupported fallback 触发。
  - Rust `layered_design_cmd` 覆盖 native structured result 与 unsupported source。
- 已验证：
  - `./node_modules/.bin/vitest run "src/lib/api/layeredDesignAnalysis.test.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts"`
  - `./node_modules/.bin/eslint "src/lib/api/layeredDesignAnalysis.ts" "src/lib/api/layeredDesignAnalysis.test.ts" "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/structuredAnalyzer.worker.ts" "src/lib/layered-design/structuredAnalyzerWorker.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/index.ts" "src/components/workspace/canvas/CanvasFactory.tsx" "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `CARGO_TARGET_DIR="/tmp/lime-p5i-native-analyzer-target" cargo test --manifest-path "src-tauri/Cargo.toml" analyze_layered_design_flat_image --lib`
  - `CARGO_TARGET_DIR="/tmp/lime-p5i-native-analyzer-target" cargo test --manifest-path "src-tauri/Cargo.toml" layered_design_cmd --lib`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" -- --check`
  - `npm run test:contracts`
  - `git diff --check -- ...`

### 2026-05-07 P5K-0 DEV smoke native analyzer 注入

- 已在 DEV-only `src/pages/design-canvas-smoke.tsx` 支持 `?analyzer=native`：页面会把 P5I `createLayeredDesignNativeStructuredAnalyzerProvider(...)` 包装成现有 `AnalyzeLayeredDesignFlatImage` 后注入 `DesignCanvas.analyzeFlatImage`，仍不改变默认产品路径。
- 已扩展 `scripts/design-canvas-smoke.mjs` 的 `--analyzer <worker|native|default>` 参数：默认继续跑 `worker`，显式传 `native` 时会等待页面 badge “Native analyzer 已启用” 和 analyzer 输出 “Tauri native heuristic analyzer”。
- 这刀只补 GUI smoke 的可选验证入口，不新增 Tauri 命令、不新增 provider adapter、不回流旧 `poster_generate / canvas:poster / ImageTaskViewer`。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
- GUI native smoke 结果：
  - `npm run smoke:design-canvas -- --analyzer native --timeout-ms 240000 --interval-ms 1000` 首次在旧 DevBridge 后端下回退到默认 `本地 heuristic analyzer`，未证明 native command 已被当前后端消费。
  - 尝试重启 `npm run tauri:dev:headless` 时，被无关脏改动 `src-tauri/src/services/capability_draft_service.rs` 的 Rust 编译错误阻断；该文件不属于 AI 图层化设计主线，本轮未修改、不顺手修复。

### 2026-05-07 P5J-1 Worker refined subject mask seam

- 已扩展 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts` 的 rasterizer seam：新增可选 `cropImageWithRefinedSubjectMaskToPngDataUrl(...)` 与 `createRefinedSubjectMaskDataUrl(...)`，provider 会优先使用 refined subject mask，缺失时继续回退 ellipse mask。
- 默认 Worker rasterizer 现在先从主体裁片边缘估算背景色，再用颜色差异 + 椭圆先验生成灰度 mask，并把该 mask 应用到主体 crop alpha；输出仍是 P5A structured result，不绕过 `LayeredDesignDocument.extraction`。
- 这刀仍不宣称真实 matting：它只是把 P5J 的 mask refine 替换 seam 从“固定椭圆 mask”推进到“可替换 refined mask”，后续真实 segmentation / matting worker 可以直接替换该 seam。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 refined subject mask seam 被优先调用，并确认 ellipse fallback 不被误用。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`


### 2026-05-07 P5J-2 Worker refined clean plate seam

- 已扩展 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts` 的 rasterizer seam：新增可选 `createRefinedCleanPlateDataUrl(...)`，provider 会优先使用 refined clean plate，缺失时继续回退 `createApproximateCleanPlateDataUrl(...)`。
- 默认 Worker rasterizer 现在复用 refined subject mask，并按主体框四周采样背景色，对 mask 覆盖区域做局部近似填充；输出仍是完整 clean plate PNG data URL，继续通过 P5A structured result 写回 `LayeredDesignDocument.extraction`。
- 这刀仍不宣称真实 inpaint / clean plate 模型：它只是把 clean plate 从“固定椭圆整块填充”推进到“可替换 refined clean plate seam + 更细的本地近似修补”，后续真实 inpaint worker 可以直接替换该 seam。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 refined clean plate seam 被优先调用，并确认 approximate fallback 不被误用。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - 定向扫描 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts` 与 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 无行尾空白。


### 2026-05-07 P5J-3 Worker text candidate extractor seam

- 已扩展 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts` 的 provider option：新增可选 `textCandidateExtractor(...)`，Worker heuristic 会把标题 crop 交给该 seam，并在有文本结果时输出 structured `TextLayer` 候选。
- extractor 输入只包含可 clone 的 image metadata、标题候选 bbox、标题 crop PNG data URL 与 `createdAt`；它不会把主线程 `textOcrProvider` 函数穿过 Worker message 边界，也不会新增 Tauri 命令或 provider adapter。
- extractor 无结果、返回空文本或抛错时，provider 继续回退到原 raster 候选，确保 OCR seam 不会阻断 current 上传拆层路径。
- 这刀仍不宣称真实 OCR：它只是把 Worker 侧“标题 crop -> TextLayer structured candidate”的替换 seam 钉住，后续真实 OCR worker 可以直接替换该 extractor。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 text candidate extractor seam 能输出 `TextLayer` 候选，并通过 analyzer adapter 写回 `analysis.outputs.ocrText=true`。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - 定向扫描 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts`、`src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 与 `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 无行尾空白。
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - 定向扫描 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts`、`src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 与 `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 无行尾空白。
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - 定向扫描 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts` 与 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 无行尾空白。


### 2026-05-07 P5J-4 Worker TextLayer runtime roundtrip 回归

- 已在 `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 增加 runtime roundtrip 回归：`installLayeredDesignStructuredAnalyzerWorkerRuntime(...)` 现在会执行带 `textCandidateExtractor` 的 Worker heuristic provider，并把 `headline-candidate` 的 structured `TextLayer` result 回传主线程。
- 这刀没有新增协议字段、Tauri 命令、Bridge、mock 或 GUI 入口；它只证明 P5D/P5E worker runtime 边界能承载 P5J-3 的 `TextLayer` seam，而不是只在直接调用 provider 时成立。
- 这刀仍不宣称真实 OCR：测试中的文本来自受控 extractor fixture，只验证 `标题 crop -> TextLayer structured result -> Worker runtime response` 的工程闭环。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 覆盖 Worker runtime 执行 text extractor seam，并确认回传 result 中包含 `type: "text"` 的 `headline-candidate`。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/structuredAnalyzerWorker.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - 定向扫描 `src/lib/layered-design/structuredAnalyzerWorker.test.ts`、`src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts` 与 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 无行尾空白。


### 2026-05-07 P5J-5 Worker Logo candidate refiner seam

- 已扩展 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts` 的 provider option：新增可选 `logoCandidateRefiner(...)`，Worker heuristic 会把 Logo crop 交给该 seam，并在有结果时输出 refined logo image / optional mask structured candidate。
- refiner 输入只包含可 clone 的 image metadata、Logo 候选 bbox、Logo crop PNG data URL 与 `createdAt`；它不会新增 Tauri 命令、provider adapter 或平行拆层协议。
- refiner 无结果、返回空图片或抛错时，provider 继续回退到原 raster Logo 裁片，确保 Logo refine seam 不会阻断 current 上传拆层路径。
- 这刀仍不宣称真实 Logo 检测 / 分割：它只是把 Worker 侧“Logo crop -> refined logo image/mask structured candidate”的替换 seam 钉住，后续真实 Logo segmentation worker 可以直接替换该 refiner。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 logo candidate refiner seam 能输出带 mask 的 Logo 候选，并通过 analyzer adapter 写回 `alphaMode=mask` 与 `candidateMask=true`。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`


### 2026-05-07 P5J-6 Worker background fragment refiner seam

- 已扩展 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts` 的 provider option：新增可选 `backgroundFragmentRefiner(...)`，Worker heuristic 会把背景碎片 crop 交给该 seam，并在有结果时输出 refined effect image / optional mask structured candidate。
- refiner 输入只包含可 clone 的 image metadata、背景碎片候选 bbox、背景碎片 crop PNG data URL 与 `createdAt`；它不会新增 Tauri 命令、provider adapter 或平行拆层协议。
- refiner 无结果、返回空图片或抛错时，provider 继续回退到原 raster 背景碎片裁片，确保背景碎片 refine seam 不会阻断 current 上传拆层路径。
- 这刀仍不宣称真实背景语义拆分：它只是把 Worker 侧“背景碎片 crop -> refined effect image/mask structured candidate”的替换 seam 钉住，后续真实背景/effect segmentation worker 可以直接替换该 refiner。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 background fragment refiner seam 能输出带 mask 的背景碎片候选，并通过 analyzer adapter 写回 `alphaMode=mask` 与 `candidateMask=true`。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - 定向扫描 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts`、`src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 与 `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 无行尾空白。

### 2026-05-07 P5K-1 Worker refined seams DEV smoke fixture

- 已在 DEV-only `src/pages/design-canvas-smoke.tsx` 支持 `?analyzer=worker-refined`：页面用 in-memory Worker runtime fixture 安装带 `textCandidateExtractor`、`logoCandidateRefiner`、`backgroundFragmentRefiner` 的 Worker heuristic provider，再通过现有 Worker provider / analyzer adapter 注入 `DesignCanvas.analyzeFlatImage`。
- 已扩展 `scripts/design-canvas-smoke.mjs` 的 `--analyzer worker-refined`：脚本会等待 “Worker refined analyzer 已启用”、同一 `Worker local heuristic analyzer` 执行结果，并点选“标题文字候选”验证 `WORKER REFINED TEXT` 作为可编辑 `TextLayer` 被 GUI 可观测。
- 这刀只补 P5J seams 的 GUI smoke 可验证入口，不改变默认产品 analyzer，不新增 Tauri 命令、provider adapter、旧 poster 命令或平行拆层页面。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `git diff --check -- "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - `npm run smoke:design-canvas -- --analyzer worker --timeout-ms 240000 --interval-ms 1000`
  - `npm run smoke:design-canvas -- --analyzer worker-refined --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5L-1 Worker subject mask refiner seam

- 已扩展 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts` 的 provider option：新增可选 `subjectMaskRefiner(...)`，Worker heuristic 会先把主体 raw crop 交给该 seam，并在有结果时输出 subject image / mask structured candidate。
- refiner 输入只包含可 clone 的 image metadata、主体候选 bbox、主体 raw crop PNG data URL 与 `createdAt`；它不会新增 Tauri 命令、provider adapter、旧 poster 命令或平行拆层协议。
- refiner 无结果、返回空图片/mask 或抛错时，provider 继续回退 P5J refined subject mask / ellipse fallback，确保真实 matting seam 不会阻断 current 上传拆层路径。
- 这刀仍不宣称真实 matting / segmentation：它只是把 Worker 侧“主体 raw crop -> matting image/mask structured candidate”的 provider-level 替换 seam 钉住，后续真实 segmentation/matting worker 可以直接替换该 refiner。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 subject mask refiner seam 能输出带 mask 的主体候选，并通过 analyzer adapter 写回 `alphaMode=mask` 与 `candidateMask=true`。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5L-2 Worker subject mask runtime roundtrip 回归

- 已在 `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 增加 runtime roundtrip 回归：`installLayeredDesignStructuredAnalyzerWorkerRuntime(...)` 现在会执行带 `subjectMaskRefiner` 的 Worker heuristic provider，并把 `subject-candidate` 的 subject image / mask structured result 回传主线程。
- 这刀没有新增协议字段、Tauri 命令、Bridge、mock 或 GUI 入口；它只证明 P5D/P5E worker runtime 边界能承载 P5L-1 的 subject matting seam，而不是只在直接调用 provider 时成立。
- 这刀仍不宣称真实 matting / segmentation：测试中的主体 image/mask 来自受控 refiner fixture，只验证 `主体 raw crop -> subject image/mask structured result -> Worker runtime response` 的工程闭环。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorker.test.ts` 覆盖 Worker runtime 执行 subject mask refiner seam，并确认回传 result 中包含带 `mask` 的 `subject-candidate`。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/structuredAnalyzerWorker.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5L-3 Worker subject matting DEV smoke fixture

- 已把 DEV-only `src/pages/design-canvas-smoke.tsx` 的 `?analyzer=worker-refined` fixture 扩展为同时安装 `subjectMaskRefiner(...)`：它会把主体 crop 回写为 subject image / mask structured candidate，并把主体候选置信度固定为 `93%`，便于 GUI smoke 可观测。
- 已扩展 `scripts/design-canvas-smoke.mjs` 的 `worker-refined` 额外断言：脚本会先点选“主体候选”并等待 `subject / 置信度 93%`，再继续点选“标题文字候选”验证 `WORKER REFINED TEXT`。
- 这刀只补 P5L subject matting seam 的 DEV-only GUI 可观测入口，不改变默认产品 analyzer，不新增 Tauri 命令、provider adapter、旧 poster 命令或平行拆层页面。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `git diff --check -- "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - `npm run smoke:design-canvas -- --analyzer worker-refined --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5L-4 subject matting provider adapter

- 已新增 `src/lib/layered-design/subjectMatting.ts`：定义最小 `LayeredDesignSubjectMattingProvider` / input / result，并提供 `createLayeredDesignSubjectMaskRefinerFromMattingProvider(...)` 把 `matteSubject(...)` 包装成 Worker heuristic `subjectMaskRefiner`。
- adapter 只传递 image metadata、`createdAt`、主体候选 bbox 与主体 crop PNG data URL；它不定义模型依赖、不新增 Worker 文件、不新增 Tauri 命令，也不绕过 `LayeredDesignDocument.extraction`。
- provider 返回空 image/mask 或抛错时，adapter 返回 `null`，由 Worker heuristic 继续走 P5J refined subject mask / ellipse fallback，避免真实 matting worker 不可用时阻断 current 上传拆层主路径。
- 已补回归：
  - `src/lib/layered-design/subjectMatting.test.ts` 覆盖 matting provider 成功输出会经 subjectMaskRefiner / analyzer adapter 写回 current extraction，并覆盖 provider 无效或失败时返回 `null`。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/subjectMatting.ts" "src/lib/layered-design/subjectMatting.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/subjectMatting.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/subjectMatting.ts" "src/lib/layered-design/subjectMatting.test.ts" "src/lib/layered-design/index.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5L-5 deterministic subject matting provider

- 已在 `src/lib/layered-design/subjectMatting.ts` 新增 `createLayeredDesignDeterministicSubjectMattingProvider(...)`：它使用主体 crop 作为 subject image，并使用 1x1 不透明白色 PNG data URL 作为 mask，作为真实 matting 算法前的 deterministic provider 形态占位。
- provider 可覆盖 `label / confidence / maskSrc`，默认不引模型、不读写文件、不依赖 DOM / Canvas，也不新增 Worker 文件或 Tauri 命令；输出仍需通过 P5L-4 adapter 包装成 `subjectMaskRefiner` 后写回 current extraction。
- 这刀不宣称真实 matting：默认 mask 是全不透明占位，只用于让后续 smoke / adapter 能先走真实 provider 形态，真实 segmentation/matting 算法仍是后续项。
- 已补回归：
  - `src/lib/layered-design/subjectMatting.test.ts` 覆盖 deterministic provider 会返回主体 crop、PNG data URL mask、矩形与置信度。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/subjectMatting.ts" "src/lib/layered-design/subjectMatting.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/subjectMatting.test.ts"`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/subjectMatting.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/subjectMatting.ts" "src/lib/layered-design/subjectMatting.test.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5L-6 deterministic subject matting smoke 接入

- 已把 DEV-only `src/pages/design-canvas-smoke.tsx` 的 `worker-refined` subject seam 从手写 fixture 改为 `createLayeredDesignDeterministicSubjectMattingProvider(...)` + `createLayeredDesignSubjectMaskRefinerFromMattingProvider(...)`。
- GUI smoke 仍通过“主体候选 93% 置信度”观测 subject matting seam；区别是现在走 P5L-5 provider 形态与 P5L-4 adapter，而不是页面内手写 subject image/mask result。
- 这刀只减少 DEV-only smoke fixture 重复，不改变默认产品 analyzer，不新增 Tauri 命令、provider adapter、旧 poster 命令或平行拆层页面；deterministic provider 仍不等同真实 matting。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "src/lib/layered-design/subjectMatting.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/pages/design-canvas-smoke.tsx" "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - `npm run smoke:design-canvas -- --analyzer worker-refined --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5L-7 subject matting Worker protocol

- 已新增 `src/lib/layered-design/subjectMattingWorker.ts`：定义 `lime.layered_design.subject_matting.request/result/error`、主线程 `createLayeredDesignSubjectMattingWorkerProvider(...)` 与 Worker 侧 `installLayeredDesignSubjectMattingWorkerRuntime(...)`。
- Worker request 只携带 P5L-4 `LayeredDesignSubjectMattingInput`，result 只返回 `LayeredDesignSubjectMattingResult | null`；不传函数、不传 DOM / Canvas 对象、不新增 Tauri 命令，也不把真实模型依赖引进主 bundle。
- 该 protocol 只服务 current subject matting provider seam：后续真实 Worker 实现 `LayeredDesignSubjectMattingProvider.matteSubject(...)` 后，仍需通过 P5L-4 adapter / P5L-1 `subjectMaskRefiner` 回到 `LayeredDesignDocument.extraction`。
- 已补回归：
  - `src/lib/layered-design/subjectMattingWorker.test.ts` 覆盖主线程 worker provider 包装、非当前 request 忽略与错误透出、Worker runtime 执行 provider 并回传 result、无效消息忽略与 runtime 错误回传。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/subjectMattingWorker.ts" "src/lib/layered-design/subjectMattingWorker.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/subjectMattingWorker.test.ts" "src/lib/layered-design/subjectMatting.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/subjectMattingWorker.ts" "src/lib/layered-design/subjectMattingWorker.test.ts" "src/lib/layered-design/index.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5L-8 subject matting browser Worker factory

- 已新增 `src/lib/layered-design/subjectMatting.worker.ts`：真实 module Worker 入口会安装 P5L-7 runtime，并先接 P5L-5 deterministic subject matting provider，不引模型依赖。
- 已新增 `src/lib/layered-design/subjectMattingWorkerClient.ts`：提供 `createDefaultLayeredDesignSubjectMattingWorker()` 与 `createLayeredDesignWorkerSubjectMattingProvider(...)`，把专用 Worker protocol 实例化为可注入的 `LayeredDesignSubjectMattingProvider`。
- client 每次 `matteSubject(...)` 后都会释放 Worker；Worker 创建失败或执行失败时默认回退 deterministic provider，调试/严格模式可传 `fallbackProvider: null` 透出错误。
- 这刀只补 browser Worker handle / factory 空壳，不改 `DesignCanvas` 默认路径、不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，也不宣称真实 matting。
- 已补回归：
  - `src/lib/layered-design/subjectMattingWorkerClient.test.ts` 覆盖 Worker 创建与释放、Worker 失败 fallback、无法创建 Worker 的 deterministic fallback，以及关闭 fallback 时错误透出。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/subjectMatting.worker.ts" "src/lib/layered-design/subjectMattingWorkerClient.ts" "src/lib/layered-design/subjectMattingWorkerClient.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/subjectMattingWorkerClient.test.ts" "src/lib/layered-design/subjectMattingWorker.test.ts" "src/lib/layered-design/subjectMatting.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/subjectMatting.worker.ts" "src/lib/layered-design/subjectMattingWorkerClient.ts" "src/lib/layered-design/subjectMattingWorkerClient.test.ts" "src/lib/layered-design/index.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5L-9 subject matting Worker smoke 模式

- 已新增 DEV-only `?analyzer=worker-matting`：`src/pages/design-canvas-smoke.tsx` 会把 P5L-8 `createLayeredDesignWorkerSubjectMattingProvider(...)` 包装成 P5L-4 `subjectMaskRefiner`，再注入 Worker heuristic structured analyzer。
- 该模式使用真实 browser module Worker 入口 `subjectMatting.worker.ts`，并设置 `fallbackProvider: null`，因此 Worker 创建、protocol 往返或 runtime 失败会直接让 smoke 失败，不会静默回退 deterministic provider。
- `subjectMatting.worker.ts` 的 deterministic provider 置信度固定为 `94%`，只用于 DEV smoke 可观测，明确不代表真实 matting 模型质量。
- 已扩展 `scripts/design-canvas-smoke.mjs`：新增 `--analyzer worker-matting`，会选择主体候选并等待 `subject / 置信度 94%`，证明 subject matting Worker seam 已回到 current `DesignCanvas` 确认态。
- 这刀不改变默认产品 analyzer，不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，也不宣称真实 matting。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" "src/lib/layered-design/subjectMatting.worker.ts" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `git diff --check -- "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" "src/lib/layered-design/subjectMatting.worker.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`
  - `npm run smoke:design-canvas -- --analyzer worker-matting --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5M-1 Worker OCR provider adapter

- 已新增 `src/lib/layered-design/textOcr.ts`：提供 `createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider(...)`，可把现有 `LayeredDesignFlatImageTextOcrProvider.detectText(...)` 包装成 Worker heuristic `textCandidateExtractor`。
- adapter 会把 Worker text 候选 crop 组装成 `text_raster` asset，调用 OCR provider，归一化文本块 bbox，再输出可写回 current extraction 的 `TextLayer` structured candidate。
- 已新增 `createLayeredDesignDeterministicTextOcrProvider(...)` 作为真实 OCR 前的 deterministic provider 形态占位；它只返回可预测文本块，不宣称真实 OCR。
- 已把 DEV-only `worker-refined` smoke 的文字候选从手写 `textCandidateExtractor` 改为 deterministic OCR provider + adapter，继续通过 `WORKER REFINED TEXT` 观测 TextLayer seam。
- 这刀不改变默认产品 analyzer，不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，也不宣称真实 OCR。
- 已补回归：
  - `src/lib/layered-design/textOcr.test.ts` 覆盖 OCR provider -> Worker text extractor 映射、空结果/失败 fallback、deterministic OCR provider，以及 Worker heuristic analyzer 写回 current TextLayer extraction。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/textOcr.ts" "src/lib/layered-design/textOcr.test.ts" "src/pages/design-canvas-smoke.tsx" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/textOcr.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-refined --timeout-ms 240000 --interval-ms 1000`
  - `git diff --check -- "src/lib/layered-design/textOcr.ts" "src/lib/layered-design/textOcr.test.ts" "src/pages/design-canvas-smoke.tsx" "src/lib/layered-design/index.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5M-2 OCR Worker protocol

- 已新增 `src/lib/layered-design/textOcrWorker.ts`：定义 `lime.layered_design.text_ocr.request/result/error`、主线程 `createLayeredDesignTextOcrWorkerProvider(...)` 与 Worker 侧 `installLayeredDesignTextOcrWorkerRuntime(...)`。
- Worker request 只携带 `LayeredDesignFlatImageTextOcrProviderInput`：图片 metadata、文字候选 rect 与 text raster crop asset；result 只返回 `LayeredDesignFlatImageOcrTextBlock[]`，不传函数、不传 DOM / Canvas 对象、不新增 Tauri 命令。
- 该 protocol 只服务 current OCR provider seam：后续真实 Worker 实现 `LayeredDesignFlatImageTextOcrProvider.detectText(...)` 后，仍需通过 P5M-1 adapter / Worker heuristic `textCandidateExtractor` 回到 `LayeredDesignDocument.extraction` 的 `TextLayer` 候选。
- 已补回归：
  - `src/lib/layered-design/textOcrWorker.test.ts` 覆盖主线程 worker provider 包装、非当前 request 忽略与错误透出、Worker runtime 执行 provider 并回传 result、无效消息忽略与 runtime 错误回传。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/textOcrWorker.ts" "src/lib/layered-design/textOcrWorker.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/textOcrWorker.test.ts" "src/lib/layered-design/textOcr.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/textOcrWorker.ts" "src/lib/layered-design/textOcrWorker.test.ts" "src/lib/layered-design/index.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5M-3 OCR browser Worker factory

- 已新增 `src/lib/layered-design/textOcr.worker.ts`：真实 module Worker 入口会安装 P5M-2 runtime，并先接 P5M-1 deterministic OCR provider，不引真实 OCR / VLM 依赖。
- 已新增 `src/lib/layered-design/textOcrWorkerClient.ts`：提供 `createDefaultLayeredDesignTextOcrWorker()` 与 `createLayeredDesignWorkerTextOcrProvider(...)`，把专用 OCR Worker protocol 实例化为可注入的 `LayeredDesignFlatImageTextOcrProvider`。
- client 每次 `detectText(...)` 后都会释放 Worker；Worker 创建失败或执行失败时默认回退 deterministic OCR provider，调试/严格模式可传 `fallbackProvider: null` 透出错误。
- 这刀只补 OCR browser Worker handle / factory 空壳，不改 `DesignCanvas` 默认路径、不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，也不宣称真实 OCR。
- 已补回归：
  - `src/lib/layered-design/textOcrWorkerClient.test.ts` 覆盖 Worker 创建与释放、Worker 失败 fallback、无法创建 Worker 的 deterministic fallback，以及关闭 fallback 时错误透出。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/textOcr.worker.ts" "src/lib/layered-design/textOcrWorkerClient.ts" "src/lib/layered-design/textOcrWorkerClient.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/textOcrWorkerClient.test.ts" "src/lib/layered-design/textOcrWorker.test.ts" "src/lib/layered-design/textOcr.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/textOcr.worker.ts" "src/lib/layered-design/textOcrWorkerClient.ts" "src/lib/layered-design/textOcrWorkerClient.test.ts" "src/lib/layered-design/index.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5M-4 OCR Worker smoke 模式

- 已新增 DEV-only `?analyzer=worker-ocr`：`src/pages/design-canvas-smoke.tsx` 会把 P5M-3 `createLayeredDesignWorkerTextOcrProvider(...)` 包装成 P5M-1 `textCandidateExtractor`，再注入 Worker heuristic structured analyzer。
- 该模式使用真实 browser module Worker 入口 `textOcr.worker.ts`，并设置 `fallbackProvider: null`，因此 Worker 创建、protocol 往返或 runtime 失败会直接让 smoke 失败，不会静默回退 deterministic provider。
- 已扩展 `scripts/design-canvas-smoke.mjs`：新增 `--analyzer worker-ocr`，会选择标题文字候选并等待 `WORKER OCR TEXT`，证明 OCR Worker seam 已回到 current `DesignCanvas` 确认态的 `TextLayer` 候选。
- 这刀不改变默认产品 analyzer，不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，也不宣称真实 OCR。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `npm run smoke:design-canvas -- --analyzer worker-ocr --timeout-ms 240000 --interval-ms 1000`
  - `git diff --check -- "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5M-5 OCR provider priority 组合器

- 已在 `src/lib/layered-design/textOcr.ts` 新增 `detectTextWithLayeredDesignPrioritizedTextOcrProviders(...)` 与 `createLayeredDesignPrioritizedTextOcrProvider(...)`，统一封装 OCR provider priority：失败跳过、空文本跳过、首个有效文本块返回。
- 默认 analyzer 的 native OCR -> 浏览器 `TextDetector` 优先级判断已复用同一个 priority helper，同时保留实际命中的 provider label，确认态 metadata 仍能显示 `Tauri native OCR` 或 `浏览器 TextDetector OCR`。
- Worker OCR provider、native OCR provider、browser OCR provider 都继续复用 current `LayeredDesignFlatImageTextOcrProvider`；这刀不新增 Tauri 命令、不新增 provider adapter、不走旧 `poster_generate / ImageTaskViewer` 链路。
- 已补回归：
  - `src/lib/layered-design/textOcr.test.ts` 覆盖 priority provider 跳过失败/空文本、返回命中 provider 来源、全部失败/空时返回空数组。
  - `src/lib/layered-design/analyzer.test.ts` 继续覆盖默认 native/browser OCR priority 以及注入 OCR provider 写回 current TextLayer。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/textOcr.ts" "src/lib/layered-design/textOcr.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/textOcr.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/textOcr.ts" "src/lib/layered-design/textOcr.test.ts" "src/lib/layered-design/index.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5M-6 OCR priority smoke 模式

- 已新增 DEV-only `?analyzer=worker-ocr-priority`：`src/pages/design-canvas-smoke.tsx` 会把 P5M-5 `createLayeredDesignPrioritizedTextOcrProvider(...)` 包装到 P5M-1 `textCandidateExtractor`，再注入 Worker heuristic structured analyzer。
- 该 priority fixture 先经过失败 OCR provider 与空文本 OCR provider，再命中 P5M-3 `createLayeredDesignWorkerTextOcrProvider(...)`；GUI smoke 通过 `WORKER OCR TEXT` 观测最终 TextLayer，证明 priority + Worker OCR 组合 seam 已回到 current `DesignCanvas` 确认态。
- 已扩展 `scripts/design-canvas-smoke.mjs`：新增 `--analyzer worker-ocr-priority`，会等待 priority provider badge，选择标题文字候选并等待 `WORKER OCR TEXT`。
- 本轮用户闭环：打开 `/design-canvas-smoke?analyzer=worker-ocr-priority` -> 上传扁平 PNG -> analyzer 进入拆层确认态 -> 选择标题文字候选 -> 验证 OCR Worker 文本 -> 进入图层编辑；未发现新增 console error。
- 这刀不改变默认产品 analyzer，不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，也不宣称真实 OCR。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `npm run smoke:design-canvas -- --analyzer worker-ocr-priority --timeout-ms 240000 --interval-ms 1000`
  - `git diff --check -- "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5N-1 简单 subject matting Worker 算法占位

- 已在 `src/lib/layered-design/subjectMatting.ts` 新增 `createLayeredDesignSimpleSubjectMattingProvider(...)` 与 `applyLayeredDesignSimpleSubjectMattingToRgba(...)`：通过边缘背景采样、色差 alpha 与椭圆先验生成 matted image / mask。
- 已把 `src/lib/layered-design/subjectMatting.worker.ts` 的默认 Worker runtime 从 deterministic provider 切到 simple provider；`worker-matting` smoke 现在会穿过真实像素级算法占位，而不是只回传原 crop + 1x1 mask。
- provider 仍复用 P5L 的 `LayeredDesignSubjectMattingProvider -> subjectMaskRefiner -> Worker heuristic structured analyzer -> LayeredDesignDocument.extraction` 主链；不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter。
- 这不是生产级 matting 模型：当前只证明 browser Worker 内可以真实读裁片像素、生成 alpha/mask PNG data URL，并写回 current subject candidate；复杂 matting、语义分割、边缘发丝和 clean plate / inpaint 仍是后续项。
- 已补回归：
  - `src/lib/layered-design/subjectMatting.test.ts` 覆盖 simple matting 纯算法的中心/边缘 alpha、mask 同步，以及 provider 经 raster adapter 输出 matted image / mask data URL。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/subjectMatting.ts" "src/lib/layered-design/subjectMatting.test.ts" "src/lib/layered-design/subjectMatting.worker.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/subjectMatting.test.ts" "src/lib/layered-design/subjectMattingWorker.test.ts" "src/lib/layered-design/subjectMattingWorkerClient.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-matting --timeout-ms 240000 --interval-ms 1000`
  - `git diff --check -- "src/lib/layered-design/subjectMatting.ts" "src/lib/layered-design/subjectMatting.test.ts" "src/lib/layered-design/subjectMatting.worker.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5O-1 clean plate provider seam

- 已新增 `src/lib/layered-design/cleanPlate.ts`：定义 `LayeredDesignCleanPlateProvider` / input / result，以及 `createLayeredDesignWorkerCleanPlateRefinerFromProvider(...)`，让真实 inpaint / clean plate 执行源只需输出 clean plate asset。
- 已扩展 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts`：Worker heuristic structured analyzer 现在可接收 `cleanPlateRefiner`，优先使用 provider 输出；provider 无结果或失败时仍回退现有 refined / approximate clean plate，不阻断上传拆层主路径。
- provider 输出会写入 current `LayeredDesignDocument.extraction.cleanPlate`，asset params 标记 `seed: worker_heuristic_clean_plate_provider` 并保留 provider params，后续 UI/导出能区分 provider clean plate 与 heuristic 近似修补。
- 这刀直接服务“主体移动后不露洞”的主线；不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，也不接真实 inpaint 模型。
- 已补回归：
  - `src/lib/layered-design/cleanPlate.test.ts` 覆盖 clean plate provider -> Worker cleanPlateRefiner -> current extraction 写回、provider 空结果 fallback、deterministic provider 占位输出。
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 继续覆盖原 Worker clean plate fallback 行为。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/cleanPlate.ts" "src/lib/layered-design/cleanPlate.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/cleanPlate.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker --timeout-ms 240000 --interval-ms 1000`
  - `git diff --check -- "src/lib/layered-design/cleanPlate.ts" "src/lib/layered-design/cleanPlate.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/index.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5O-3 clean plate 风险提示 UI

- 已更新 `src/components/workspace/design/DesignCanvas.tsx`：拆层确认态在统计区显示“背景修补来源”，并用轻量提示卡说明 clean plate 成功、失败或未生成时的移动主体风险。
- 成功时会显示 provider / model / seed 来源，并提示“移动主体后仍建议核对边缘与原位置纹理”；失败时明确提示“移动主体有露洞风险”；未生成时提示可继续编辑但需人工处理背景。
- 这刀直接服务 current `LayeredDesignDocument.extraction.cleanPlate` 的产品可解释性；不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，也不改默认 analyzer。
- UI 遵循 Lime 轻盈、清晰、专业的面板风格：复用现有属性卡和状态色，只增加一张低密度提示卡，不引入新的大面积视觉语法。
- 已补回归：
  - `src/components/workspace/design/DesignCanvas.test.tsx` 覆盖 clean plate 成功时来源/风险提示，以及 clean plate 失败时“移动主体有露洞风险”的文案。
- 已验证：
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker --timeout-ms 240000 --interval-ms 1000`
  - `git diff --check -- "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5P-1 原生分层工程 roundtrip smoke

- 已扩展 `scripts/design-canvas-smoke.mjs`：新增 `--project-roundtrip`，在上传扁平图拆层前先点击“导出设计工程”与“打开最近工程”，等待恢复后的 `Smoke 图层设计海报` 和 `主标题`，再继续上传拆层确认态闭环。
- 已修复 browser mock 的工程目录读写闭环：`src/lib/tauri-mock/core.ts` 会把同一轮 `save_layered_design_project_export` 写入的 `design.json / export-manifest.json` 保存在 mock store 中，`read_layered_design_project_export` 默认读回最近保存的同一项目工程，不再静态返回空 `mock-design`。
- 已补 `src/lib/tauri-mock/core.test.ts` 回归，固定 mock 保存后读取必须保留 layer 内容、fileCount 与 assetCount；这直接服务 DEV/browser GUI smoke，不新增 Tauri 命令、不改旧 poster / ImageTaskViewer / provider adapter。
- 本轮用户闭环：打开 `/design-canvas-smoke?analyzer=worker` -> prompt seed 进入 `DesignCanvas` -> 图层选择/移动 -> 保存 `.layered-design` 工程 -> 打开最近工程 -> 恢复后继续可编辑 -> 上传扁平 PNG -> Worker analyzer 进入拆层确认态 -> 进入图层编辑；未发现新增 console error。
- 已验证：
  - `./node_modules/.bin/eslint "scripts/design-canvas-smoke.mjs" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" --max-warnings 0`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `./node_modules/.bin/vitest run "src/lib/tauri-mock/core.test.ts"`
  - `npm run smoke:design-canvas -- --analyzer worker --project-roundtrip --timeout-ms 240000 --interval-ms 1000`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run test:contracts`

### 2026-05-07 P5P-2 roundtrip 默认 smoke 门槛

- 已把 `scripts/design-canvas-smoke.mjs` 的 `projectRoundtrip` 默认值改为开启：现在执行 `npm run smoke:design-canvas` 默认会先验证 prompt seed 工程保存、打开最近工程和恢复后继续编辑，再进入上传扁平图拆层闭环。
- 已保留 `--project-roundtrip` 作为显式语义参数，并新增 `--skip-project-roundtrip` 只用于定位非持久化链路问题；默认门槛不再只覆盖“打开画布 + 上传拆层”的半链路。
- 这刀直接服务 current 主链的可持续回归：`LayeredDesignDocument -> canvas:design -> DesignCanvas -> 工程目录保存/读取 -> 继续编辑 -> 上传拆层`；不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter。
- 已验证：
  - `./node_modules/.bin/eslint "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `npm run smoke:design-canvas -- --analyzer worker --timeout-ms 240000 --interval-ms 1000`，输出包含 `stage=project-roundtrip-save-open` 并通过
- 额外尝试：
  - `npm run verify:gui-smoke -- --reuse-running --timeout-ms 600000 --interval-ms 1000` 未跑到 design canvas 阶段；前置 `workspace-ready / browser-runtime / site-adapters / agent-service-skill-entry / agent-runtime-tool-surface` 已通过，随后 `smoke:agent-runtime-tool-surface-page` 等待期间 DevBridge 变为不可用并失败，归类为本地 headless/DevBridge 环境中断，不是本轮 `DesignCanvas` 默认 roundtrip 失败。

### 2026-05-07 P5Q-1 简单像素级 clean plate Worker provider

- 已在 `src/lib/layered-design/cleanPlate.ts` 新增 `applyLayeredDesignSimpleCleanPlateInpaintToRgba(...)`：它读取原图 RGBA、主体 rect 与可选 mask，用周边邻域像素对主体原位置做最小像素级修补，并返回 filled / total subject 像素计数。
- 已新增 `createLayeredDesignSimpleCleanPlateProvider(...)`：在 Worker / browser 环境通过 OffscreenCanvas 解码原图与 mask、编码修补后的 PNG data URL，并写入 `provider / model: simple_neighbor_inpaint_v1 / sourceRect / filledPixelCount / totalSubjectPixelCount / maskApplied` 元数据。
- 已把 `src/lib/layered-design/structuredAnalyzer.worker.ts` 的默认 Worker analyzer 接入 simple clean plate provider，经现有 `cleanPlateRefiner -> Worker heuristic structured analyzer -> LayeredDesignDocument.extraction.cleanPlate` 主链写回，不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter。
- 这不是生产级 inpaint：当前只证明默认 Worker 能真实读像素并修补主体原位置；复杂纹理、语义背景、主体阴影和边缘一致性仍要后续模型级 clean plate / inpaint worker。
- 已补回归：
  - `src/lib/layered-design/cleanPlate.test.ts` 覆盖纯算法修补主体 rect、带 mask 的 provider 输出、provider seam 写回 current extraction、provider fallback 与 deterministic 占位。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/cleanPlate.ts" "src/lib/layered-design/cleanPlate.test.ts" "src/lib/layered-design/structuredAnalyzer.worker.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/cleanPlate.test.ts" "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts"`
  - 重建 `/tmp/lime-layered-design-tsconfig.json` 后执行 `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker --timeout-ms 240000 --interval-ms 1000`
- 验证备注：
  - 本轮开始时 DevBridge 不可用，`smoke:design-canvas` 首次停在 `stage=wait-health`；随后重新启动 `npm run tauri:dev:headless`，DevBridge 监听 `3030` 后复跑 DesignCanvas smoke 通过。

### 2026-05-07 P5Q-2 clean plate Worker protocol / browser factory

- 已新增 `src/lib/layered-design/cleanPlateWorker.ts`：定义 `lime.layered_design.clean_plate.request/result/error`，提供主线程 `createLayeredDesignCleanPlateWorkerProvider(...)` 与 Worker 侧 `installLayeredDesignCleanPlateWorkerRuntime(...)`。
- 已新增 `src/lib/layered-design/cleanPlate.worker.ts`：真实 module Worker 入口安装 P5Q-1 `createLayeredDesignSimpleCleanPlateProvider(...)`，后续模型级 inpaint 只需替换 provider。
- 已新增 `src/lib/layered-design/cleanPlateWorkerClient.ts`：提供 `createDefaultLayeredDesignCleanPlateWorker()` 与 `createLayeredDesignWorkerCleanPlateProvider(...)`，支持 Worker 创建/释放、错误 fallback、关闭 fallback 时透出错误。
- 已更新 `src/lib/layered-design/index.ts` 导出 clean plate Worker protocol 与 client；不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，仍通过 `cleanPlateRefiner -> Worker heuristic structured analyzer -> LayeredDesignDocument.extraction.cleanPlate` 回到 current 主链。
- 已补回归：
  - `src/lib/layered-design/cleanPlateWorker.test.ts` 覆盖主线程 worker provider 包装、无关消息忽略、错误透出、Worker runtime 执行 provider 与错误回传。
  - `src/lib/layered-design/cleanPlateWorkerClient.test.ts` 覆盖 browser Worker 创建/释放、Worker 失败 fallback、无法创建 Worker 的 deterministic fallback，以及关闭 fallback 时错误透出。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/cleanPlateWorker.ts" "src/lib/layered-design/cleanPlateWorker.test.ts" "src/lib/layered-design/cleanPlate.worker.ts" "src/lib/layered-design/cleanPlateWorkerClient.ts" "src/lib/layered-design/cleanPlateWorkerClient.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/cleanPlateWorker.test.ts" "src/lib/layered-design/cleanPlateWorkerClient.test.ts" "src/lib/layered-design/cleanPlate.test.ts"`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5Q-3 clean plate Worker GUI smoke 可观测模式

- 已在 DEV-only `src/pages/design-canvas-smoke.tsx` 新增 `?analyzer=worker-clean-plate`：页面会把 P5Q-2 `createLayeredDesignWorkerCleanPlateProvider(...)` 包装成 P5O `cleanPlateRefiner`，再注入 Worker heuristic structured analyzer。
- 该模式让 GUI 上传拆层路径真实穿过 clean plate browser Worker provider、P5Q-2 Worker protocol、P5Q-1 simple clean plate provider，再回到 current `LayeredDesignDocument.extraction.cleanPlate`。
- 已扩展 `scripts/design-canvas-smoke.mjs`：新增 `--analyzer worker-clean-plate`，等待 “Worker clean plate analyzer 已启用”，并在拆层确认态断言 `背景修补来源：Simple browser clean plate provider / simple_neighbor_inpaint_v1`。
- 本轮用户闭环：打开 `/design-canvas-smoke?analyzer=worker-clean-plate` -> prompt seed roundtrip 保存/打开 -> 上传扁平 PNG -> clean plate Worker provider 命中 -> 确认态展示 provider/model 来源 -> 进入图层编辑；未发现新增 console error。
- 这刀不改变默认产品 analyzer，不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter，也不宣称 simple provider 是真 inpaint。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-clean-plate --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5R-1 analyzer provider capability / IO contract

- 已新增 `src/lib/layered-design/providerCapabilities.ts`：统一定义 `subject_matting / clean_plate / text_ocr` 三类 analyzer provider capability、执行位置、IO support matrix、limits 与 quality 标记。
- 已登记当前内置能力：simple browser subject matting、simple browser clean plate、deterministic placeholder、Worker OCR、Tauri native OCR、Browser TextDetector OCR 与 Worker heuristic clean plate fallback；全部标记为非生产级，避免把 simple / deterministic 能力误判成真模型。
- 已提供 registry 纯函数：按 kind 查询、按 requirement 选择、输出不满足原因 warning、生成可读 summary；后续真实 matting / inpaint / OCR 模型只需补 capability，不再各自发明平行接口。
- 已更新 `src/lib/layered-design/index.ts` 导出该协议；这刀只做库层协议，不新增 Tauri 命令、不改 GUI 主路径、不新增旧 poster / ImageTaskViewer / provider adapter。
- 已补回归：
  - `src/lib/layered-design/providerCapabilities.test.ts` 覆盖三类能力查询、clean plate mask + PNG + cleanPlateOutput 选择、productionReady 不误命中、OCR textGeometry/native command 选择、warning 与 summary。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/providerCapabilities.ts" "src/lib/layered-design/providerCapabilities.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/providerCapabilities.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/providerCapabilities.ts" "src/lib/layered-design/providerCapabilities.test.ts" "src/lib/layered-design/index.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5R-2 capability metadata 回写确认态

- 已扩展 `LayeredDesignExtractionAnalysis` / input：允许在 current `LayeredDesignDocument.extraction.analysis` 中保存 analyzer provider capability metadata，并在 `normalizeLayeredDesignDocument` / extraction copy 路径中保留该字段。
- 已让 `createLayeredDesignFlatImageAnalysisResultFromStructuredResult(...)` 透传 `providerCapabilities`；本地 heuristic analyzer 会按 clean plate / OCR 命中情况写入对应 capability，Worker heuristic analyzer 会按 subject matting refiner、text extractor 与 clean plate seed 写入内置能力。
- 已更新 `DesignCanvas` 拆层确认态：在现有轻量属性卡里新增“能力矩阵”，并列出 provider capability summary，明确 simple / heuristic 能力属于“实验/占位，需人工复核”，不把它宣称为生产级模型。
- 已补回归：
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 Worker analyzer metadata 回写到 current analysis。
  - `src/components/workspace/design/DesignCanvas.test.tsx` 覆盖确认态显示能力矩阵、provider summary 与人工复核提示。
- 这刀直接服务 current `LayeredDesignDocument -> canvas:design -> DesignCanvas -> analyzer provider` 主链；不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/providerCapabilities.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/providerCapabilities.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-clean-plate --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5R-3 capability requirement gate / export manifest 投影

- 已在 `src/lib/layered-design/providerCapabilities.ts` 新增 capability gate：可根据 `subject_matting / clean_plate / text_ocr` 的 requirement 检查当前 provider capability 是否满足生产准入，并输出 `passed / failed / missing`、命中 capability、warning 与 `readyForProduction`。
- 已提供 `createLayeredDesignAnalyzerProviderCapabilityGateRequirements(...)`：根据是否需要主体 matting、clean plate、OCR text geometry 生成默认生产准入要求；默认要求 `productionReady: true`，因此当前 simple / heuristic / deterministic 能力会明确失败，而不是被误判为生产级。
- 已在 `src/lib/layered-design/export.ts` 把 `LayeredDesignDocument.extraction.analysis` 投影进 `export-manifest.json`：
  - `analysis.analyzer`
  - `analysis.outputs`
  - `analysis.providerCapabilities`
  - `analysis.capabilityGate`
- 已补回归：
  - `src/lib/layered-design/providerCapabilities.test.ts` 覆盖 simple clean plate 不满足生产准入。
  - `src/lib/layered-design/export.test.ts` 覆盖 export manifest 中 capability gate 的 `readyForProduction: false` 与 warning。
- 这刀让专业工程导出能够保留“当前拆层用了什么能力、是否生产级、失败在哪里”的机器可读证据；不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/providerCapabilities.ts" "src/lib/layered-design/providerCapabilities.test.ts" "src/lib/layered-design/export.ts" "src/lib/layered-design/export.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/providerCapabilities.test.ts" "src/lib/layered-design/export.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5S-1 analyzer model slot 协议

- 已新增 `src/lib/layered-design/analyzerModelSlots.ts`：定义真实模型接入前的单一 analyzer model slot，覆盖 `subject_matting / clean_plate / text_ocr` 三类能力。
- model slot 只接回既有 current seam：
  - `LayeredDesignSubjectMattingProvider.matteSubject(...)`
  - `LayeredDesignCleanPlateProvider.createCleanPlate(...)`
  - `LayeredDesignFlatImageTextOcrProvider.detectText(...)`
- 已复用 P5R capability gate：`evaluateLayeredDesignAnalyzerModelSlotProductionGate(...)` 可判断某个 slot 是否满足生产准入；slot 的 `kind` 与 `capability.kind` 不一致会直接拒绝接入，避免真实模型接入时串线。
- 已更新 `src/lib/layered-design/index.ts` 导出 model slot 协议；这刀不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer、不接具体供应商，也不新增平行 analyzer 主链。
- 已补回归：
  - `src/lib/layered-design/analyzerModelSlots.test.ts` 覆盖 clean plate / subject matting / OCR slot 接回既有 provider seam、production gate 失败、kind mismatch 拒绝接入。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlots.ts" "src/lib/layered-design/analyzerModelSlots.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlots.test.ts" "src/lib/layered-design/providerCapabilities.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5S-2 analyzer model slot -> Worker heuristic analyzer 组合

- 已在 `src/lib/layered-design/analyzerModelSlots.ts` 新增 `createLayeredDesignWorkerHeuristicModelSlotOptions(...)`：把 subject matting / clean plate / OCR model slot 组合成现有 Worker heuristic analyzer options。
- 组合函数只复用现有 current seam：
  - subject matting slot -> `createLayeredDesignSubjectMaskRefinerFromMattingProvider(...)`
  - clean plate slot -> `createLayeredDesignWorkerCleanPlateRefinerFromProvider(...)`
  - OCR slot -> `createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider(...)`
  - slot capability -> `providerCapabilities`
- 已补 `src/lib/layered-design/analyzerModelSlots.test.ts` 集成闭环：三个 slot 同时进入 `createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider(...)`，再经 `createLayeredDesignFlatImageAnalyzerFromStructuredProvider(...)` 回到 `LayeredDesignDocument.extraction` 输入形态，验证 subject mask、clean plate、OCR text 和 providerCapabilities 都写回。
- 这刀证明真实模型 slot 后续只需要实现 `execute(...)`，不用新增 provider adapter、不新增平行 analyzer 主链、不回流旧 poster / ImageTaskViewer。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlots.ts" "src/lib/layered-design/analyzerModelSlots.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlots.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5S-3 model slot GUI smoke fixture

- 已在 DEV-only `src/pages/design-canvas-smoke.tsx` 新增 `?analyzer=worker-model-slots`：页面构造 subject matting / clean plate / OCR 三个假 model slot，并通过 P5S-2 `createLayeredDesignWorkerHeuristicModelSlotOptions(...)` 接入现有 Worker heuristic analyzer。
- 假 slot 输出会回到 current 拆层确认态：
  - 主体候选置信度 `98%`
  - OCR 文本 `MODEL SLOT OCR`
  - clean plate 来源 `Smoke model slot clean plate / smoke-clean-plate-slot-v1`
  - capability 矩阵显示 `3 项 / 均生产可用`
- 已扩展 `scripts/design-canvas-smoke.mjs`：新增 `--analyzer worker-model-slots`，断言 badge、主体置信度、OCR 文本、clean plate 来源和 capability 矩阵，继续覆盖默认工程 roundtrip。
- 这刀证明 model slot 不止停在库层，而是能穿过真实页面上传拆层路径回到 `DesignCanvas` 确认态；不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer、不接具体供应商。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5T-1 analyzer model slot config schema

- 已新增 `src/lib/layered-design/analyzerModelSlotConfig.ts`：定义真实模型接入前的 provider slot config schema，只覆盖 current `subject_matting / clean_plate / text_ocr` 三类 analyzer model slot。
- schema 固化后续接具体模型前必须声明的边界：
  - `id / kind / label / execution / modelId`
  - IO contract：PNG data URL、alpha 输出、mask 输入/输出、文字几何、clean plate 输出
  - runtime：`timeoutMs / maxAttempts / fallbackStrategy`
  - metadata：`providerId / modelVersion / productionReady / deterministic / requiresHumanReview / tags`
- 已提供纯函数：
  - `normalizeLayeredDesignAnalyzerModelSlotConfig(...)`
  - `validateLayeredDesignAnalyzerModelSlotConfig(...)`
  - `createLayeredDesignAnalyzerProviderCapabilityFromModelSlotConfig(...)`
  - `createLayeredDesignAnalyzerModelSlotMetadata(...)`
  - `evaluateLayeredDesignAnalyzerModelSlotConfigReadiness(...)`
- readiness 会同时跑 schema warning 与 P5R/P5S 的 production gate；默认 `productionReady: false`，所以未声明生产级的真实模型配置不会被误判为可上线。
- 已更新 `src/lib/layered-design/index.ts` 导出配置协议；这刀不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer、不接具体供应商，也不新增平行主链。
- 已补回归：
  - `src/lib/layered-design/analyzerModelSlotConfig.test.ts` 覆盖 clean plate 配置归一化、capability / metadata 导出、三类默认 IO、schema warning、readiness 失败与生产级通过。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotConfig.ts" "src/lib/layered-design/analyzerModelSlotConfig.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotConfig.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5T-2 analyzer model slot config export manifest 投影

- 已扩展 `src/lib/layered-design/export.ts`：`createLayeredDesignExportBundle(..., { analyzerModelSlotConfigs })` 会把真实模型 slot config 归一化后写入 `export-manifest.json` 的 `analyzerModelSlots`。
- 每个 `analyzerModelSlots[]` 条目包含：
  - `config`：归一化后的 slot config，不包含任何执行函数或供应商密钥。
  - `readiness`：schema warning、capability、production gate 与 `valid` 结果。
- 这让工程包能保留“准备接入哪些真实模型、IO/timeout/fallback 怎么配置、是否满足生产准入”的审计证据；仍不接具体供应商、不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer。
- 已补回归：
  - `src/lib/layered-design/export.test.ts` 覆盖 `export-manifest.json` 中同时出现失败 clean plate slot 与生产级 OCR slot 的 config / readiness。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/export.ts" "src/lib/layered-design/export.test.ts" "src/lib/layered-design/analyzerModelSlotConfig.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/export.test.ts" "src/lib/layered-design/analyzerModelSlotConfig.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5T-3 analyzer model slot config GUI 导出闭环

- 已把 P5T-2 `analyzerModelSlotConfigs` 从库层导出推进到 GUI 主链：`DesignCanvas` 在“导出设计工程”时会把传入的 slot config 交给 `createLayeredDesignExportBundle(...)`，写入 `export-manifest.json.analyzerModelSlots`。
- 已扩展 `CanvasFactory` 的 design 专属注入参数，DEV smoke 可同时注入 `designAnalyzeFlatImage` 与 `designAnalyzerModelSlotConfigs`；该入口只服务 `canvas:design -> DesignCanvas`，不新增平行主链。
- 已让 `/design-canvas-smoke?analyzer=worker-model-slots` 复用同一组 `WORKER_MODEL_SLOT_CONFIGS`：假 slot 的 capability 与导出 manifest 的 config/readiness 来自同一配置事实源，避免 UI fixture 与导出审计各写一套。
- 已补 `DesignCanvas.test.tsx` 回归：工作区绑定时保存工程目录，断言 `export-manifest.json` 包含目标 clean plate slot 的 config 与 `readiness.productionGate.readyForProduction: true`。
- 已扩展 `scripts/design-canvas-smoke.mjs`：`worker-model-slots` 模式完成工程保存后，会在页面上下文读取同一个 browser mock 工程导出 store，断言 manifest 存在三类 slot 与 readiness；随后继续打开最近工程、上传扁平图、确认拆层和进入编辑。
- 这刀证明真实模型 slot 配置可以穿过 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> export manifest -> GUI smoke`，形成可审计闭环；不新增 Tauri 命令、不新增旧 poster / ImageTaskViewer / provider adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/components/workspace/design/types.ts" "src/components/workspace/canvas/CanvasFactory.tsx" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/export.test.ts" "src/lib/layered-design/analyzerModelSlotConfig.test.ts"`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5U-1 analyzer model slot runtime seam

- 已新增 `src/lib/layered-design/analyzerModelSlotRuntime.ts`：把 P5T 的 `LayeredDesignAnalyzerModelSlotConfigInput` 推进为可执行的 analyzer model slot runtime seam。
- 新 runtime 只创建并返回现有 P5S model slot 类型，不新增 provider adapter 或平行 analyzer 主链：
  - `createLayeredDesignSubjectMattingModelSlotFromConfig(...)`
  - `createLayeredDesignCleanPlateModelSlotFromConfig(...)`
  - `createLayeredDesignTextOcrModelSlotFromConfig(...)`
- runtime 统一处理真实模型接入前必须稳定的工程边界：config kind 校验、schema 可执行性校验、capability 生成、执行 metadata、`AbortSignal`、`timeoutMs`、`maxAttempts`、`return_null / throw / use_heuristic` fallback 策略。
- 该 seam 不调用任何具体供应商、不接密钥、不训练模型；真实 subject matting / clean plate / OCR 后续只需要实现 `execute(input, context)`，再接回 P5S 的 Worker heuristic analyzer options。
- 已更新 `src/lib/layered-design/index.ts` 导出 runtime seam，保证后续 GUI smoke、真实模型实验或 native bridge 都消费同一个 current 协议。
- 已补 `src/lib/layered-design/analyzerModelSlotRuntime.test.ts`：覆盖 config -> 可执行 slot、metadata/context 透传、retry、失败 return_null、严格 throw、use_heuristic fallback，以及 kind mismatch 拒绝创建。
- 这刀把“manifest 审计里准备接哪些模型”推进到“这些模型如何被安全执行并回到 current slot seam”；仍然不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 Tauri 命令。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotRuntime.ts" "src/lib/layered-design/analyzerModelSlotRuntime.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotRuntime.test.ts" "src/lib/layered-design/analyzerModelSlotConfig.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5U-2 analyzer model slot runtime GUI smoke 接入

- 已把 DEV-only `src/pages/design-canvas-smoke.tsx` 的 `worker-model-slots` fixture 从“手写 slot + 手写 capability”改为消费 P5U-1 runtime seam。
- `createSmokeModelSlotsWorkerAnalyzer()` 现在通过同一组 `WORKER_MODEL_SLOT_CONFIGS` 调用：
  - `createLayeredDesignSubjectMattingModelSlotFromConfig(...)`
  - `createLayeredDesignCleanPlateModelSlotFromConfig(...)`
  - `createLayeredDesignTextOcrModelSlotFromConfig(...)`
- clean plate fixture 的 provider/model 来源改为从 runtime `context.metadata` 回填，证明执行路径确实穿过 config -> runtime context，而不是只在 manifest 审计里出现。
- 这刀把 P5T/P5U-1 的库层协议推进到真实页面上传拆层 smoke：`config -> executable slot -> Worker heuristic analyzer -> DesignCanvas 拆层确认态 -> export-manifest readiness`，仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" --max-warnings 0`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`（DevBridge 等待约 148s 后通过）

### 2026-05-07 P5U-3 analyzer model slot runtime 执行证据回写

- 已让 P5U-1 `analyzerModelSlotRuntime` 在成功执行或 `use_heuristic` fallback 成功时自动把 `modelSlotExecution` 写入输出 `params`，包含 `slotId / slotKind / providerLabel / modelId / execution / attempt / maxAttempts / timeoutMs / fallbackStrategy / fallbackUsed / status`，以及可选 `providerId / modelVersion`。
- 已扩展 current 图层协议的轻量 metadata 承载：`BaseDesignLayer.params` 会被 normalize 保留；OCR TextLayer 因此可保存实际执行 slot 证据，不需要新增另一条 analyzer 结果协议。
- 已让 subject matting 结果、OCR block、Worker heuristic subject asset、clean plate asset 与 OCR TextLayer 透传 runtime evidence：
  - subject matting -> subject asset `params.modelSlotExecution`
  - clean plate -> clean plate asset `params.modelSlotExecution`
  - text OCR -> TextLayer `params.modelSlotExecution`
- 已补 `src/lib/layered-design/analyzerModelSlotRuntime.test.ts`：覆盖 direct runtime 输出 evidence、retry attempt 记录、fallback evidence，以及 `config -> executable slot -> Worker heuristic analyzer -> extraction candidates / cleanPlate` 的端到端回写。
- 这刀让导出的 `design.json` / `export-manifest.json` 不只知道“配置了哪些模型”，还可以从候选资产或 TextLayer params 追踪“本次实际跑了哪个 slot、跑到第几次、是否 fallback”；仍不接具体供应商、不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotRuntime.ts" "src/lib/layered-design/analyzerModelSlotRuntime.test.ts" "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" "src/lib/layered-design/subjectMatting.ts" "src/lib/layered-design/textOcr.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotRuntime.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts" "src/lib/layered-design/document.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5U-4 export manifest 执行证据投影

- 已扩展 `src/lib/layered-design/export.ts` 的 `LayeredDesignExportManifest`：新增 `evidence.modelSlotExecutions`，从 `LayeredDesignDocument.assets[].params.modelSlotExecution` 与 `layers[].params.modelSlotExecution` 汇总实际 analyzer model slot 执行证据。
- 每条 manifest evidence 会保留执行事实与来源引用：`slotId / slotKind / providerLabel / modelId / execution / attempt / maxAttempts / timeoutMs / fallbackStrategy / fallbackUsed / status`，以及 `sources[]` 中的 asset 或 layer 引用。
- evidence 汇总不改变 `design.json` 事实源，只是 export 投影；外部审计现在不必逐个解析 layer/asset params，也能看出本次拆层实际跑了哪个 subject matting / clean plate / OCR slot。
- 已补 `src/lib/layered-design/export.test.ts`：覆盖 subject asset、clean plate asset、OCR TextLayer 三类 `modelSlotExecution` 汇总到 `export-manifest.json.evidence.modelSlotExecutions`。
- 这刀继续收敛 `LayeredDesignDocument -> export-manifest.json` 主链；不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/export.ts" "src/lib/layered-design/export.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/export.test.ts" "src/lib/layered-design/analyzerModelSlotRuntime.test.ts" "src/lib/layered-design/document.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5U-5 DesignCanvas 拆层确认态执行证据可见化

- 已在 `src/components/workspace/design/DesignCanvas.tsx` 的拆层确认态新增“模型执行”摘要：从 current `LayeredDesignDocument.extraction` 关联的候选 asset、clean plate asset 与 TextLayer `params.modelSlotExecution` 汇总实际 analyzer model slot 执行证据。
- 用户现在能在进入编辑前直接看到类似 `主体抠图：runtime-matting-v1 / attempt 1/1 / succeeded`、`背景修补：runtime-inpaint-v1 / attempt 2/2 / succeeded`、`OCR TextLayer：runtime-ocr-v1 / attempt 1/1 / fallback_succeeded` 的轻量摘要；fallback 会明确显示“已走 fallback”。
- UI 仍沿用当前 `DesignCanvas` 宽工作台右侧 inspector 的实体卡片、浅边框、低饱和状态色和中文优先信息层级；没有引入新的页面结构、半透明主表面或额外 viewer。
- 已补 `DesignCanvas.test.tsx` 回归：覆盖 subject matting、clean plate 与 OCR TextLayer 三类执行证据在拆层确认态可见，并验证 fallback 文案。
- 已扩展 `scripts/design-canvas-smoke.mjs` 的 `worker-model-slots` 模式：GUI smoke 现在会断言“模型执行”以及三类 slot 的实际执行摘要，证明 runtime evidence 已穿过真实页面上传拆层路径。
- 这刀继续收敛 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> analyzer model slot runtime` 主链；不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts"`
  - 重建 `/tmp/lime-layered-design-tsconfig.json` 后执行 `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `./node_modules/.bin/eslint "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5V-1 analyzer model slot transport 协议

- 已新增 `src/lib/layered-design/analyzerModelSlotTransport.ts`：在 P5U runtime seam 之上定义真实 remote/native executor transport 协议，只负责把外部执行器接进 current model slot，不新增 provider adapter 或平行 analyzer 主链。
- transport request 统一携带 `kind / input / context`，其中 `context` 继续复用 P5U 的 `LayeredDesignAnalyzerModelSlotExecutionContext`，后续远程服务、原生插件或本地 worker executor 都能读取同一份 `slotId / modelId / providerId / attempt / AbortSignal`。
- 已提供三类最小适配函数，输出仍然回到既有 runtime 装饰与 evidence 写回：
  - `createLayeredDesignSubjectMattingModelSlotFromTransport(...)`
  - `createLayeredDesignCleanPlateModelSlotFromTransport(...)`
  - `createLayeredDesignTextOcrModelSlotFromTransport(...)`
- 缺失 transport handler 时不让调用方绕过 runtime：adapter 会抛出明确错误，再交给 P5U 的 `return_null / throw / use_heuristic` 策略处理；因此 `return_null` 仍能保持拆层主链不中断。
- 已更新 `src/lib/layered-design/index.ts` 导出 transport 协议，真实模型接入方后续只实现 transport handler，不需要改 `DesignCanvas`、导出协议或旧图片任务链路。
- 已补 `src/lib/layered-design/analyzerModelSlotTransport.test.ts`：覆盖 subject matting / clean plate / OCR 三类 handler 的 context 透传、runtime retry、输出 `params.modelSlotExecution` 装饰、缺 handler return_null 不中断，以及 config kind mismatch 拒绝创建。
- 这刀继续收敛 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> analyzer model slot runtime/transport` 主链；不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增具体供应商接入。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotTransport.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/index.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzerModelSlotRuntime.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P5V-2 analyzer model slot transport GUI smoke 接入

- 已把 DEV-only `src/pages/design-canvas-smoke.tsx` 的 `worker-model-slots` fixture 从 P5U 的 direct runtime execute 改为消费 P5V-1 transport seam：
  - `createLayeredDesignSubjectMattingModelSlotFromTransport(...)`
  - `createLayeredDesignCleanPlateModelSlotFromTransport(...)`
  - `createLayeredDesignTextOcrModelSlotFromTransport(...)`
- 新增 smoke transport handler 会读取同一份 runtime `context.metadata` 回填 clean plate 来源与模型 ID，证明页面上传拆层路径实际穿过 `transport -> runtime -> model slot -> Worker heuristic analyzer -> DesignCanvas`，而不是只在库层测试 transport。
- 已扩展 `scripts/design-canvas-smoke.mjs` 的 `worker-model-slots` 断言：新增 transport fixture 文案检查，并把 clean plate 来源更新为 `Smoke model slot clean plate transport / smoke-clean-plate-slot-v1`。
- 这刀继续收敛 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> analyzer model slot transport/runtime` 主链；不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增具体供应商 adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzerModelSlotRuntime.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5V-3 analyzer model slot transport 错误分类

- 已扩展 `src/lib/layered-design/analyzerModelSlotTransport.ts`：新增 transport 层稳定错误分类，覆盖 `missing_handler / unsupported_input / invalid_request / invalid_response / unauthorized / rate_limited / remote_unavailable / timeout / cancelled / safety_blocked / unknown`。
- 已新增 `LayeredDesignAnalyzerModelSlotTransportError`，统一承载 `code / message / retryable / statusCode / providerErrorCode / details / cause`，让后续真实 remote/native handler 能表达“是否可重试、供应商状态码、供应商错误码、输入或响应问题”，而不用把这些语义藏进普通字符串错误。
- 已新增 helper：
  - `createLayeredDesignAnalyzerModelSlotTransportError(...)`
  - `isLayeredDesignAnalyzerModelSlotTransportError(...)`
  - `normalizeLayeredDesignAnalyzerModelSlotTransportError(...)`
- 缺失 handler 现在也抛出 classified `missing_handler` transport error；runtime 的 `return_null / throw / use_heuristic` 策略不变，仍由 P5U 主 runtime 决定是否中断主链。
- 已补 `src/lib/layered-design/analyzerModelSlotTransport.test.ts`：覆盖缺 handler 在 `throw` 策略下保留 `missing_handler` 分类、handler 抛出 `rate_limited` 可重试错误时 runtime 原样保留分类，以及 normalize 对已分类/未知错误的处理。
- 这刀继续收敛 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> analyzer model slot transport/runtime` 主链；不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增具体供应商 adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotTransport.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzerModelSlotRuntime.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-07 P4H-2 PSD 试点 writer 与专业交付闭环

- 根据“先补主缺口再磨细节”的规则，本刀从 P5V transport 细节回到 P4 专业交付主缺口：路线图要求 PSD 试点文件能被专业工具打开并看到图层列表，之前只有 `psd-like-manifest.json`。
- 已新增 `src/lib/layered-design/psd.ts`：无依赖写出最小 PSD binary，使用同一份 `LayeredDesignDocument` 投影图层名称、顺序、可见性、基础矩形 bounds、blend mode、opacity 与占位像素。
- 已扩展 `src/lib/layered-design/export.ts`：
  - `LayeredDesignExportManifest.trialPsdFile = "trial.psd"`
  - `LayeredDesignExportBundle.trialPsdFile`
  - ZIP 工程包与 Tauri 工程目录文件列表都会包含 `trial.psd`
- 已更新 `DesignCanvas` 导出提示文案，让用户知道工程包里包含 `trial.psd`；仍从同一个“导出设计工程”入口进入，不新增平行导出主链。
- 已补 `src/lib/layered-design/export.test.ts`：验证 PSD header、画布尺寸、色彩模式、图层数量，并确认 ZIP / 工程目录文件列表包含 `trial.psd`。
- 已补 `DesignCanvas.test.tsx`：绑定工作区保存工程目录时断言 `trial.psd` 以 base64 文件进入 current project export 文件列表。
- 当前 PSD 试点不是完整像素级 PSD 还原，也不承诺 TextLayer 在 Photoshop 内保持原生文字可编辑；它先满足“专业工具可打开并看到图层列表”的 P4 主验收口径，完整 PSD 互操作、真实像素图层和外部打开验证仍是后续主缺口。
- 这刀继续收敛 `LayeredDesignDocument -> Exporter -> ZIP / project directory -> Artifact evidence` 主链；不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增 provider adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/psd.ts" "src/lib/layered-design/export.ts" "src/lib/layered-design/export.test.ts" "src/lib/layered-design/index.ts" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/export.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5N-2 简单 subject matting 质量增强

- 根据“先补主缺口再磨细节”的规则，本刀继续补完整 Lovart 产品目标里的结果质量主缺口，而不是继续扩展 transport 或 PSD 细节。
- 已增强 `src/lib/layered-design/subjectMatting.ts` 的简单 Worker subject matting 算法：
  - 对 first-pass alpha mask 做孤立前景噪点清理。
  - 对小孔做邻域补洞。
  - 对前景/背景交界做轻量羽化，降低硬边。
  - provider 结果写入 `params.seed = simple_subject_matting_color_distance_v2`、`foregroundPixelCount` 与 `totalPixelCount`，方便后续导出证据和调试。
- 已补 `src/lib/layered-design/subjectMatting.test.ts`：覆盖孤立噪点被清理、主体连通区域保留，以及 provider 输出质量统计 metadata。
- 这刀直接提升 `worker-matting` 上传拆层主路径的主体透明图层质量；仍不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/subjectMatting.ts" "src/lib/layered-design/subjectMatting.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/subjectMatting.test.ts" "src/lib/layered-design/subjectMattingWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-matting --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5Q-4 简单 clean plate 质量增强

- 根据“先补主缺口再磨细节”的规则，本刀继续补可编辑体验主缺口：主体移动后，原主体位置的背景修补要尽量利用 mask 周边真实背景，不能只停留在整块 rect 外框取样。
- 已增强 `src/lib/layered-design/cleanPlate.ts` 的 simple clean plate 像素级修补：
  - 预先构建 mask coverage map，只把真实主体覆盖区域作为待修补区域。
  - 对待修补像素做八方向局部背景采样，优先使用 mask 周边非主体像素；当局部采样不足时再回退 rect 外框采样。
  - 对与原主体颜色过近的局部样本降噪跳过，降低错误 mask 把主体颜色当背景继续扩散的风险。
  - 对修补边缘做轻量平滑，减少主体移开后的硬边洞口。
  - provider 结果继续保持 `model: simple_neighbor_inpaint_v1` 兼容既有 smoke / 能力矩阵，同时增加 `algorithm: coverage_aware_directional_inpaint` 与 `algorithmVersion: 2` 证据。
- 已补 `src/lib/layered-design/cleanPlate.test.ts`：覆盖 mask 周边背景优先修补、非 mask 背景不被误改，以及 provider 输出新增算法 metadata。
- 这刀直接提升 `worker-clean-plate` 上传拆层主路径的背景修补可信度；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/cleanPlate.ts" "src/lib/layered-design/cleanPlate.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/cleanPlate.test.ts" "src/lib/layered-design/cleanPlateWorker.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-clean-plate --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5R-1 TextLayer 内容编辑闭环

- 根据“先补主缺口再磨细节”的规则，本刀补 P1/P3 共同验收口径里的主缺口：普通文案已经能作为 TextLayer 进入 current 文档，但用户还必须能直接编辑文字内容，否则 OCR/TextLayer 只是可移动图片式候选，不是真可编辑设计。
- 已扩展 `src/lib/layered-design/types.ts` 与 `src/lib/layered-design/document.ts`：
  - 新增 `text_updated` edit history 类型。
  - 新增 `updateTextLayerProperties(...)`，支持写回 `text / fontSize / color / align`，并把 preview 标记为 stale。
  - 如果 TextLayer 来自 extraction candidate，同步更新 `extraction.candidates[].layer`，避免后续候选状态回写时丢失用户改过的 OCR 文案。
- 已更新 `src/components/workspace/design/DesignCanvas.tsx`：选中 TextLayer 时属性栏显示“文字编辑”，可直接修改文字内容、字号、颜色和对齐；锁定图层时编辑控件禁用。
- 已补回归：
  - `src/lib/layered-design/document.test.ts` 覆盖 TextLayer 内容/样式编辑、candidate 同步、preview stale 与 edit history。
  - `src/components/workspace/design/DesignCanvas.test.tsx` 覆盖属性栏编辑 TextLayer 文案后写回 `LayeredDesignDocument`，且不把文字层烘焙成图片资产。
- 这刀直接提升 `OCR TextLayer -> DesignCanvas -> 用户编辑 -> LayeredDesignDocument` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/types.ts" "src/lib/layered-design/document.ts" "src/lib/layered-design/document.test.ts" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/document.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5R-2 多文本候选与 OCR TextLayer 拆出

- 根据“先补主缺口再磨细节”的规则，本刀继续补 P3 “普通文案转 TextLayer”的主缺口：上传扁平图不能只假设一条标题文案，正文/按钮文案也必须能成为可选 TextLayer。
- 已扩展 `src/lib/layered-design/flatImageHeuristics.ts`：默认本地 heuristic candidate specs 从 `主体 + 标题 + Logo + 边角碎片` 前进到 `主体 + 标题 + 正文/按钮文字 + Logo + 边角碎片`。
- 已更新 `src/lib/layered-design/analyzer.ts`：默认 local analyzer 不再只 OCR 第一条 text candidate，而是遍历所有 text candidates；native OCR / TextDetector / 注入 OCR provider 命中时，标题和正文/按钮都可分别升级为独立 TextLayer。
- Worker heuristic analyzer 由于消费同一份 candidate specs，也会把 `textCandidateExtractor` 应用于标题与正文/按钮两块文本候选；失败时仍按单候选 fallback，不阻断其他候选层。
- 已补回归：
  - `src/lib/layered-design/flatImage.test.ts` 覆盖新增 `body-text-candidate`，并确认高置信度正文/按钮文字默认 materialize。
  - `src/lib/layered-design/analyzer.test.ts` 覆盖注入 OCR provider 与 native OCR 对标题、正文/按钮两个 text candidates 都生成 TextLayer。
  - `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts` 覆盖 Worker text candidate extractor 对两个文本候选均执行并写回 TextLayer。
- 这刀直接提升 `flat image -> OCR/TextLayer candidates -> DesignCanvas -> LayeredDesignDocument` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/flatImageHeuristics.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/lib/layered-design/textOcr.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`
  - `npm run smoke:design-canvas -- --analyzer worker-ocr --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P4H-3 PSD 试点 TextLayer 语义投影

- 根据“先补主缺口再磨细节”的规则，本刀回到 P4 专业交付主缺口：`trial.psd` 不能只让专业工具看到匿名色块层，至少要把 TextLayer 文案语义带进 PSD layer 信息，便于设计师和后续导入器识别。
- 已更新 `src/lib/layered-design/psd.ts`：
  - trial PSD writer 版本升到 `2026-05-07.trial-psd.p2`。
  - TextLayer 在 PSD 图层名中追加短文本预览，例如 `主标题 · 咖啡 & 甜点 <入门>`，让 Photoshop / Photopea / Affinity 图层面板更容易识别文案层。
  - TextLayer 额外写入可跳过的 PSD tagged layer info block `LmTx`，内容为 Lime 自定义 UTF-8 JSON，包含 `id / name / text / fontFamily / fontSize / color / align / lineHeight / letterSpacing`。
  - 仍明确标记 `fallback: rasterized_placeholder_layer`，不谎称已实现 Photoshop 原生可编辑 TypeLayer。
- 已补 `src/lib/layered-design/export.test.ts`：验证 `trial.psd` 保留图层数，并包含 `LmTx`、`lime.layered-design.text-layer`、真实 TextLayer 文案和 fallback 标记。
- 这刀直接提升 `LayeredDesignDocument -> Exporter -> trial.psd / ZIP / project directory` 专业交付主链；仍不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增平行导出协议。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/psd.ts" "src/lib/layered-design/export.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/export.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `git diff --check -- "src/lib/layered-design/psd.ts" "src/lib/layered-design/export.test.ts" "docs/exec-plans/ai-layered-design-implementation-plan.md"`

### 2026-05-07 P5R-3 同一 OCR 候选多块 TextLayer 拆分

- 根据“先补主缺口再磨细节”的规则，本刀继续补 P3/P5R 的可编辑文字主缺口：同一个 OCR 候选内如果识别出多块文字，不能再合并成一个带换行的 TextLayer，否则用户无法分别移动、编辑标题、副标题或按钮文案。
- 已更新 `src/lib/layered-design/analyzer.ts`：`detectTextCandidateFromImageCandidate(...)` 从单个 detected text candidate 改为按 OCR block 生成一个或多个 `LayeredDesignFlatImageStructuredTextCandidate`。
- 已同步 `src/lib/layered-design/textOcr.ts` 与 `src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts`：Worker OCR adapter 也不再把多个 OCR block 合并成一个 `text: "A\nB"`，而是返回多条 TextLayer result，并由 Worker heuristic analyzer 展平成多个 structured text candidates。
- 单块 OCR 仍保持原 candidate id，避免破坏既有 `headline-candidate` / `body-text-candidate` 回归；多块 OCR 使用稳定 id：`${sourceCandidateId}-text-${index + 1}`。
- 多块拆分时每个 TextLayer 使用自己的 bounding box、fontSize、confidence、zIndex，并把 `ocrSourceCandidateId / ocrBlockIndex / ocrBlockCount` 写入 layer params；如果 OCR block 带 `params.modelSlotExecution`，也会保留到对应 TextLayer。
- 已补 `src/lib/layered-design/analyzer.test.ts`：覆盖注入 OCR provider 对同一 `headline-candidate` 返回两块文本时，结果中出现 `headline-candidate-text-1` 与 `headline-candidate-text-2` 两个独立 TextLayer，且不再保留合并后的 `headline-candidate` TextLayer。
- 已补 `src/lib/layered-design/textOcr.test.ts`：覆盖 Worker OCR adapter 多块 OCR 输出经 Worker heuristic analyzer 写回多个独立 TextLayer，固定 default analyzer 与 Worker analyzer 两条 current OCR 主路径行为一致。
- 这刀直接提升 `flat image -> OCR blocks -> independent TextLayer -> DesignCanvas -> LayeredDesignDocument` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzer.ts" "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/textOcr.ts" "src/lib/layered-design/textOcr.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzer.test.ts" "src/lib/layered-design/flatImage.test.ts" "src/lib/layered-design/textOcr.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`
  - `npm run smoke:design-canvas -- --analyzer worker-ocr --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5S-1 DesignCanvas transform 属性直接编辑

- 根据“先补主缺口再磨细节”的规则，本刀回到 Canvas Editor 可编辑体验主缺口：图层属性不能只读展示位置、尺寸、旋转、透明度和层级，否则用户只能靠按钮微调，距离“可编辑设计工程”还差一步。
- 已更新 `src/components/workspace/design/DesignCanvas.tsx`：属性面板的 `X / Y / 宽 / 高 / 旋转 / 透明度 / 层级` 从只读值改成现有 Lime 表单风格的 number input，锁定图层时禁用。
- 所有 transform 编辑继续调用既有 `updateLayerTransform(...)`，写回同一份 `LayeredDesignDocument.layers`，并保持 preview stale、editHistory `transform_updated` 与 zIndex 排序逻辑，不新增前端局部状态或平行 canvas runtime。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx`：覆盖直接编辑位置、尺寸、旋转、透明度和层级后写回 `LayeredDesignDocument`，并确认 preview stale 与 transform edit history。
- 这刀直接提升 `LayeredDesignDocument -> DesignCanvas -> 用户编辑 transform -> editHistory / preview stale` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5S-2 DesignCanvas 画布内拖拽移动

- 根据“先补主缺口再磨细节”的规则，本刀继续补 Canvas Editor 可编辑体验主缺口：图层不能只靠属性栏和方向按钮移动，用户必须能直接在画布上拖动图层。
- 已更新 `src/components/workspace/design/DesignCanvas.tsx`：可见图层支持 pointer drag，拖拽时按当前 stage 尺寸换算成画布坐标，并继续通过 `updateLayerTransform(...)` 写回 `LayeredDesignDocument.layers`。
- 拖拽过程中会保持选中层、展示轻量提示“拖拽移动图层”；锁定图层和拆层确认态不允许拖动，避免确认前改正式图层栈。
- 拖拽移动仍记录 `editHistory.type = "transform_updated"`、标记 preview stale，并使用 summary `画布内拖拽移动图层。` 作为可追踪证据；没有新增局部 canvas runtime 或旧 viewer。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx`：模拟画布尺寸与 pointer drag，覆盖拖拽后按画布比例更新 TextLayer `x/y`、preview stale 和 transform edit history。
- 这刀直接提升 `LayeredDesignDocument -> DesignCanvas -> 画布直接移动 -> editHistory / preview stale` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5S-3 DesignCanvas 画布角点缩放

- 根据“先补主缺口再磨细节”的规则，本刀继续补 Canvas Editor 可编辑体验主缺口：图层已经能画布内拖动，但还必须能直接在画布上缩放，否则用户仍要频繁跳回属性栏改宽高。
- 已更新 `src/components/workspace/design/DesignCanvas.tsx`：选中且未锁定的图层显示四个角点缩放手柄，支持 `nw / ne / sw / se` 四角 pointer resize。
- 缩放时按当前 stage 尺寸换算成画布坐标，西侧/北侧手柄会同步调整 `x/y`，东侧/南侧手柄调整 `width/height`；最小尺寸限制为 `16` 画布单位，避免缩成不可操作。
- 缩放仍统一调用 `updateLayerTransform(...)` 写回 `LayeredDesignDocument.layers`，记录 `editHistory.type = "transform_updated"`、标记 preview stale，并使用 summary `画布内缩放图层。`；锁定图层和拆层确认态不显示手柄。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx`：模拟 stage 尺寸和 `se` 角点 pointer resize，覆盖按画布比例更新 TextLayer `width/height`、preview stale 和 transform edit history。
- 这刀直接提升 `LayeredDesignDocument -> DesignCanvas -> 画布直接缩放 -> editHistory / preview stale` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5S-4 DesignCanvas 画布内旋转手柄

- 根据“先补主缺口再磨细节”的规则，本刀继续补 Canvas Editor 可编辑体验主缺口：移动和缩放已经可在画布直接完成，旋转也必须进入同一交互闭环，而不是只能靠属性栏输入。
- 已更新 `src/components/workspace/design/DesignCanvas.tsx`：选中且未锁定的图层显示画布内旋转手柄，支持 pointer rotate。
- 旋转时根据图层中心点与 pointer 角度差计算 `rotation`，并继续通过 `updateLayerTransform(...)` 写回 `LayeredDesignDocument.layers`。
- 旋转仍记录 `editHistory.type = "transform_updated"`、标记 preview stale，并使用 summary `画布内旋转图层。`；锁定图层和拆层确认态不显示旋转手柄，也不会新增局部 canvas runtime。
- 已补 `src/components/workspace/design/DesignCanvas.test.tsx`：模拟 stage 尺寸与旋转手柄 pointer drag，覆盖围绕 TextLayer 中心计算并写回 `rotation`、preview stale 和 transform edit history。
- 这刀直接提升 `LayeredDesignDocument -> DesignCanvas -> 画布直接旋转 -> editHistory / preview stale` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5T-1 拆层确认质量评估

- 根据“先补主缺口再磨细节”的规则，本刀从 Canvas 细节回到 P3 拆层质量主缺口：用户进入编辑前必须知道本次 mask、clean plate、OCR TextLayer 与 provider 能力是否可信，而不是只看到一串 analyzer metadata。
- 已新增 `src/lib/layered-design/extractionQuality.ts`：纯函数 `evaluateLayeredDesignExtractionQuality(...)` 会基于同一份 `LayeredDesignDocument.extraction` 评估拆层质量，输出 `score / level / label / summary / findings`。
- 质量评估当前覆盖：
  - 未选择候选层。
  - 已选低置信候选。
  - 已选主体缺少可核对 mask。
  - 已选图片层但 clean plate 未提供或失败。
  - OCR TextLayer 未提供。
  - analyzer provider capability 标记为实验或需人工复核。
- 已更新 `src/components/workspace/design/DesignCanvas.tsx`：拆层确认态新增“拆层质量评估”提示，显示 `可进入编辑 / 需要人工复核 / 高风险`、分数、摘要与具体风险项；仍只消费 current `extraction`，不新增平行确认状态。
- 已补回归：
  - `src/lib/layered-design/extractionQuality.test.ts` 覆盖可进入编辑、高风险、需人工复核三类评分。
  - `src/components/workspace/design/DesignCanvas.test.tsx` 覆盖确认态展示高风险、clean plate 失败、OCR 缺失、实验能力需人工复核等风险文案。
- 这刀直接提升 `LayeredDesignDocument.extraction -> DesignCanvas 确认态 -> 人工复核决策 -> 再进入编辑` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/extractionQuality.ts" "src/lib/layered-design/extractionQuality.test.ts" "src/lib/layered-design/index.ts" "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/extractionQuality.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/document.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5W-1 高风险拆层确认门槛

- 根据“先补主缺口再磨细节”的规则，本刀接在 P5T-1 拆层质量评估之后，继续补 P3 拆层质量主缺口：高风险拆层不能只作为提示展示，否则用户仍会把缺 mask / 缺 clean plate 的候选层误确认成可编辑图层。
- 已更新 `src/components/workspace/design/DesignCanvas.tsx`：
  - 当 `evaluateLayeredDesignExtractionQuality(extraction).level === "high_risk"` 时，“进入图层编辑”按钮默认禁用，并给出明确 title。
  - `confirmExtractionReview` 增加同源保护，即使测试或非鼠标路径绕过 disabled，也会阻止确认并提示用户先重新拆层或选择“仅保留原图”。
  - 拆层确认态新增高风险门槛提示，明确“重新拆层 / 仅保留原图”仍是可用出口；不新增二次确认弹窗，不新增平行 review 状态。
- 已更新 `src/components/workspace/design/DesignCanvas.test.tsx`：
  - 覆盖高风险拆层时直接进入编辑被阻止，review 仍保持 `pending`，且“仅保留原图”保持可用。
  - 原确认成功回归改用 clean plate 可用但仍需人工复核的 fixture，确保 `review` 级别仍可进入编辑。
- 这刀直接提升 `LayeredDesignDocument.extraction -> DesignCanvas 质量门槛 -> 安全进入编辑 / 仅保留原图降级` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，不新增 provider adapter 或平行主链。
- 已验证：
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/components/workspace/design/DesignCanvas.test.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/components/workspace/design/DesignCanvas.test.tsx" "src/lib/layered-design/extractionQuality.test.ts" "src/lib/layered-design/document.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5W-2 产品默认上传拆层 worker-first

- 根据“先补主缺口再磨细节”的规则，本刀不继续扩展 transport polish，而是把已经验证过的 Worker analyzer 从 DEV-only 注入推进到产品默认上传拆层路径：用户不传 `analyzeFlatImage` 时，`DesignCanvas` 默认先走 `createLayeredDesignWorkerHeuristicAnalyzer()`，Worker 不可用或失败时再回退本地 analyzer。
- 已更新 `src/lib/layered-design/structuredAnalyzer.worker.ts`：默认 structured analyzer Worker 同时装入 simple subject matting refiner 与 simple clean plate provider；默认 Worker 路径现在能产出 94% 主体 matting 置信度、mask、透明主体候选和简单像素级 clean plate metadata。
- 已更新 `src/lib/layered-design/structuredAnalyzerWorkerClient.ts`：新增 worker-first 默认 analyzer helper，Worker 成功后仍会用 fallback/local OCR 结果补 TextLayer；这样默认路径不会因为切到 Worker matting / clean plate 而丢掉原先 native OCR / `TextDetector` 的可编辑文字能力。
- 已更新 `src/components/workspace/design/DesignCanvas.tsx`：上传扁平图主入口默认消费 worker-first analyzer；测试、DEV smoke 或真实 analyzer 仍可通过 `analyzeFlatImage` 明确注入，不新增 Tauri 命令、不新增 provider adapter、不改变 `LayeredDesignDocument.extraction` 事实源。
- 已更新 `scripts/design-canvas-smoke.mjs`：默认 `smoke:design-canvas` 不再显式注入 `worker`，而是使用 `--analyzer default` 验证产品默认路径；新增断言确保默认路径展示 `Worker local heuristic analyzer`、主体 94% 置信度和 `Simple browser clean plate provider / simple_neighbor_inpaint_v1` 来源。
- 这刀直接提升 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> default analyzer -> Worker matting/clean plate -> extraction review` 主链，避免真实产品默认仍停留在弱本地 heuristic，而只在 smoke 参数里看起来更强。
- 已验证：
  - `./node_modules/.bin/eslint "src/components/workspace/design/DesignCanvas.tsx" "src/lib/layered-design/structuredAnalyzer.worker.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.ts" "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/structuredAnalyzerWorkerClient.test.ts" "src/lib/layered-design/structuredAnalyzerWorkerHeuristic.test.ts" "src/components/workspace/design/DesignCanvas.test.tsx"`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5W-3 model slot configs + transport analyzer 工厂

- 根据“先补主缺口再磨细节”的规则，本刀继续把真实模型执行从 smoke 手写 fixture 收口到 current 工程 API：调用方只需要提供 `analyzerModelSlotConfigs + LayeredDesignAnalyzerModelSlotTransport`，即可生成可接入 `DesignCanvas.analyzeFlatImage` 的 analyzer。
- 已新增 `src/lib/layered-design/analyzerModelSlotAnalyzer.ts`：
  - `createLayeredDesignAnalyzerModelSlotsFromTransport(...)` 会从同一组 slot config 中选择 `subject_matting / clean_plate / text_ocr` 三类 slot，并复用 P5V transport runtime。
  - `createLayeredDesignFlatImageAnalyzerFromModelSlotTransport(...)` 会把这些 slot 接入既有 Worker heuristic structured analyzer provider，再通过 current `createLayeredDesignFlatImageAnalyzerFromStructuredProvider(...)` 输出标准 `LayeredDesignFlatImageAnalysisResult`。
  - 该工厂不新增 provider adapter、不新增 Tauri 命令、不新增平行 artifact；只是把 P5T/P5U/P5V 的 config/runtime/transport 串回同一条 analyzer 主链。
- 已更新 `src/pages/design-canvas-smoke.tsx`：`worker-model-slots` fixture 不再手写三类 slot wiring，而是复用新工厂；真实页面 smoke 继续验证 `transport -> model slot runtime -> structured analyzer -> DesignCanvas`。
- 已补 `src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts`：
  - 覆盖三类 config + transport 收口成 analyzer 后，输出主体 mask、clean plate、OCR TextLayer、provider capability 与 model slot execution evidence。
  - 覆盖只配置部分 slot 时，其余能力仍可交给 heuristic fallback，不阻断 current 上传拆层主链。
- 已更新 `src/lib/layered-design/index.ts` 导出新工厂，后续真实模型 handler 接入不需要复制 smoke wiring。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotAnalyzer.ts" "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/index.ts" "src/pages/design-canvas-smoke.tsx" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`

### 2026-05-07 P5W-4 model slot 统一 transport handler

- 根据“先补主缺口再磨细节”的规则，本刀继续补真实模型接入的最小可执行闭环：真实模型方不应再实现三套分散的 `executeSubjectMatting / executeCleanPlate / executeTextOcr` wiring，而应只实现一个统一 handler，并按 `request.kind` 与 `request.context.config` 路由。
- 已扩展 `src/lib/layered-design/analyzerModelSlotTransport.ts`：
  - 新增 `LayeredDesignAnalyzerModelSlotTransportAnyRequest`、`LayeredDesignAnalyzerModelSlotTransportHandler` 与 `createLayeredDesignAnalyzerModelSlotTransportFromHandler(...)`。
  - 统一 handler 会收到同一份 runtime context：`config / metadata / attempt / signal`，可读取 slot id、kind、providerId、modelId、fallback/timeout 等配置。
  - handler 输出会被按 kind 做最小结构校验：subject matting 必须返回 `imageSrc + maskSrc`，clean plate 必须返回 `src`，OCR 必须返回 text block array；非法输出统一抛 classified `invalid_response`。
- 已补 `src/lib/layered-design/analyzerModelSlotTransport.test.ts`：
  - 覆盖统一 handler 同时路由三类 model slot，并保留 runtime execution evidence。
  - 覆盖 handler 非法响应会稳定输出 `invalid_response`，方便后续真实远端/native handler 失败时进入同一 runtime fallback 策略。
- 这刀直接服务 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> model slot configs -> unified transport handler -> extraction review` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增具体供应商 adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotTransport.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`

### 2026-05-08 P5W-5 model slot 标准 JSON executor 适配

- 根据“先补主缺口再磨细节”的规则，本刀继续把 P5W-4 的统一 handler 推进为真实执行源可直接落地的标准 JSON executor：外部远端模型、本地 native 执行器或测试 fixture 只需要接收稳定 JSON request、返回稳定 JSON result，再由 current transport handler 校验并接回 runtime。
- 已扩展 `src/lib/layered-design/analyzerModelSlotTransport.ts`：
  - 新增 `LayeredDesignAnalyzerModelSlotTransportJsonRequest` / `LayeredDesignAnalyzerModelSlotTransportJsonResult` / `LayeredDesignAnalyzerModelSlotTransportJsonExecutor`。
  - 新增 `createLayeredDesignAnalyzerModelSlotTransportFromJsonExecutor(...)`：内部复用 `createLayeredDesignAnalyzerModelSlotTransportFromHandler(...)`，不绕过已有 runtime retry / fallback / execution evidence。
  - JSON request 的 `context` 只暴露可序列化字段：`slotId / slotKind / providerLabel / modelId / execution / attempt / maxAttempts / timeoutMs / fallbackStrategy / providerId / modelVersion / metadata`，不暴露 `AbortSignal` 或完整 `config` 对象。
  - JSON result 会先校验 `response.kind === request.kind`；kind 不匹配统一输出 classified `invalid_response`，再交给 runtime `return_null / throw / use_heuristic` 策略处理。
- 已补 `src/lib/layered-design/analyzerModelSlotTransport.test.ts`：
  - 覆盖标准 JSON executor 同时执行 subject matting、clean plate、OCR 三类 slot，并保留 `params.modelSlotExecution` 证据。
  - 覆盖 JSON executor 收到的 context 不包含 `signal / config`，避免真实执行源依赖不可序列化对象。
  - 覆盖 JSON executor 返回错误 kind 时稳定输出 `invalid_response`，方便真实模型接入失败时走同一 fallback 面。
- 这刀直接服务 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> model slot configs -> standard JSON executor -> unified transport handler -> extraction review` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增具体供应商 adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotTransport.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-08 P5W-6 标准 JSON executor -> flat image analyzer 工厂

- 根据“先补主缺口再磨细节”的规则，本刀把 P5W-5 的标准 JSON executor 直接接到 current `AnalyzeLayeredDesignFlatImage` 工厂，避免真实模型接入方还要手写 `JSON executor -> transport -> model slots -> structured analyzer` 这段重复 wiring。
- 已扩展 `src/lib/layered-design/analyzerModelSlotAnalyzer.ts`：
  - 新增 `createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor(...)`。
  - 内部复用 `createLayeredDesignAnalyzerModelSlotTransportFromJsonExecutor(...)` 与既有 `createLayeredDesignFlatImageAnalyzerFromModelSlotTransport(...)`，因此不绕过 runtime retry / fallback / execution evidence，也不新增平行 analyzer 主链。
- 已补 `src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts`：
  - 覆盖标准 JSON executor 可直接收口成 current flat image analyzer。
  - 验证 subject matting、clean plate、OCR 三类输出会继续投影到 `LayeredDesignDocument.extraction` 结果形态，并保留 `params.modelSlotExecution`。
  - 验证 executor 收到的 context 不包含 `signal / config`，真实执行源仍只依赖可序列化 JSON。
- 这刀直接服务 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> model slot configs -> standard JSON executor -> flat image analyzer -> extraction review` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增具体供应商 adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotAnalyzer.ts" "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/analyzerModelSlotTransport.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`

### 2026-05-08 P5W-7 标准 JSON executor DesignCanvas smoke 接入

- 根据“先补主缺口再磨细节”的规则，本刀把 P5W-6 从库层推进到真实 `DesignCanvas` smoke 页面：`worker-model-slots` 模式不再手写 transport fixture，而是直接使用 `createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor(...)`。
- 已更新 `src/pages/design-canvas-smoke.tsx`：
  - `worker-model-slots` analyzer 现在由 `WORKER_MODEL_SLOT_CONFIGS + createSmokeModelSlotJsonExecutor()` 生成。
  - JSON executor 按 `request.kind` 返回 subject matting、clean plate、OCR 三类标准 JSON result，并通过 current model slot runtime 写回执行证据。
  - 页面 badge 从 `Analyzer model slots transport fixture` 更新为 `Analyzer model slots JSON executor fixture`，让 smoke 断言能观察到新主链。
- 已更新 `scripts/design-canvas-smoke.mjs`：
  - `worker-model-slots` 的 fixture 文案与 clean plate 来源断言改为 JSON executor 路径。
  - 仍保留 analyzer model slot manifest、capability、execution evidence 与工程 roundtrip 断言。
- 这刀直接服务 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> model slot configs -> standard JSON executor -> flat image analyzer -> extraction review -> GUI smoke` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增具体供应商 adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" "src/lib/layered-design/analyzerModelSlotAnalyzer.ts" "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`

### 2026-05-08 P5W-8 provider -> 标准 JSON executor 适配

- 根据“先补主缺口再磨细节”的规则，本刀不再继续扩协议，而是把现有 subject matting / clean plate / OCR provider seam 统一包装成标准 JSON executor，让真实 worker/native/remote provider 能直接进入 P5W-6 的 analyzer 工厂。
- 已扩展 `src/lib/layered-design/analyzerModelSlotTransport.ts`：
  - 将 `LayeredDesignAnalyzerModelSlotTransportJsonRequest` 收紧为按 `kind` 判别的 union，避免 JSON executor 误读不可用 input 字段。
  - 新增 `LayeredDesignAnalyzerModelSlotJsonExecutorProviders` 与 `createLayeredDesignAnalyzerModelSlotJsonExecutorFromProviders(...)`。
  - provider 适配器按 `request.kind` 调用 `matteSubject / createCleanPlate / detectText`，并返回同一套标准 JSON result；缺 provider 时输出 classified `missing_handler`，继续交给 runtime fallback 策略处理。
- 已更新 `src/pages/design-canvas-smoke.tsx`：
  - `worker-model-slots` 不再手写 JSON result fixture，而是用 `createLayeredDesignAnalyzerModelSlotJsonExecutorFromProviders(...)` 包装现有 Worker subject matting、Worker clean plate、Worker OCR provider。
  - smoke 仍通过 `createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor(...)` 接回 current `DesignCanvas` 上传拆层路径。
- 已更新 `scripts/design-canvas-smoke.mjs`：
  - `worker-model-slots` 断言改为 provider JSON executor fixture，并验证 Worker OCR 文案、Worker clean plate 来源、capability、model slot execution evidence 与工程 roundtrip。
- 这刀直接服务 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> model slot configs -> worker providers -> standard JSON executor -> flat image analyzer -> extraction review -> GUI smoke` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`，也不新增具体供应商 adapter。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotTransport.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/analyzerModelSlots.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`

### 2026-05-08 P5W-9 native OCR provider -> 标准 JSON executor smoke

- 根据“先补主缺口再磨细节”的规则，本刀优先把已有 native OCR provider 接进 P5W-8 的 provider JSON executor 主链，不新增 Tauri 命令、不新增 provider adapter，也不继续扩协议。
- 已更新 `src/pages/design-canvas-smoke.tsx`：
  - 新增 `worker-model-slots-native-ocr` smoke 模式。
  - 该模式继续使用 `WORKER_MODEL_SLOT_CONFIGS` 与 `createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor(...)`，但 OCR provider 改为 `createLayeredDesignPrioritizedTextOcrProvider([createLayeredDesignNativeTextOcrProvider(), Worker OCR provider])`。
  - native OCR 不可用、无文本或抛错时继续 fallback 到 Worker OCR，确保 GUI smoke 稳定，同时真实经过已有 `recognize_layered_design_text` 边界。
- 已更新 `scripts/design-canvas-smoke.mjs`：
  - 新增 `worker-model-slots-native-ocr` 参数、帮助文案、badge 断言、priority provider 断言、工程 manifest / capability / execution evidence 断言。
  - 首次运行时 DevBridge 正在重新编译，健康检查超时；待 DevBridge 恢复后同一命令通过。
- 已补 `src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts`：
  - 覆盖 `createLayeredDesignNativeTextOcrProvider(mock recognize)` 经 `createLayeredDesignAnalyzerModelSlotJsonExecutorFromProviders(...)` 与 `createLayeredDesignFlatImageAnalyzerFromModelSlotJsonExecutor(...)` 接回 current analyzer。
  - 断言 native OCR 输出会成为可编辑 `TextLayer`，并保留 `params.modelSlotExecution`。
- 这刀直接服务 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> model slot configs -> native OCR provider -> standard JSON executor -> flat image analyzer -> extraction review -> GUI smoke` 主链；仍不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`。
- 已验证：
  - `./node_modules/.bin/eslint "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - 重建 `/tmp/lime-layered-design-tsconfig.json` 后执行 `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `node "scripts/design-canvas-smoke.mjs" --help`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots-native-ocr --timeout-ms 240000 --interval-ms 1000`

### 2026-05-08 P5W-10 默认 provider JSON executor 工厂

- 根据“先补主缺口再磨细节”的规则，本刀把 P5W-8/P5W-9 中仍停留在 smoke 页的 `worker providers + native OCR priority + JSON executor` wiring 下沉为可复用工程工厂，避免真实接入方继续复制 smoke 里的手写组合。
- 已扩展 `src/lib/layered-design/analyzerModelSlotAnalyzer.ts`：
  - 新增 `LAYERED_DESIGN_DEFAULT_MODEL_SLOT_TEXT_OCR_PRIORITY_LABEL`。
  - 新增 `createLayeredDesignDefaultAnalyzerModelSlotJsonExecutor(...)`：默认包装 Worker subject matting provider、Worker clean plate provider，以及 `Tauri native OCR -> Worker OCR` priority provider。
  - 新增 `createLayeredDesignFlatImageAnalyzerFromDefaultModelSlotProviders(...)`：调用方只需提供 model slot configs，即可得到可接入 `DesignCanvas.analyzeFlatImage` 的 current analyzer；仍复用 existing model slot runtime / JSON executor / structured analyzer，不新增平行主链。
- 已更新 `src/pages/design-canvas-smoke.tsx`：
  - `worker-model-slots` 与 `worker-model-slots-native-ocr` 改为复用 `createLayeredDesignFlatImageAnalyzerFromDefaultModelSlotProviders(...)`。
  - `worker-model-slots` 通过显式 `modelSlotTextOcrProvider` 继续验证纯 Worker OCR 路径；`worker-model-slots-native-ocr` 使用默认 native OCR priority 路径。
- 已补 `src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts`：
  - native OCR provider 的回归改为穿过默认 provider JSON executor analyzer 工厂，证明工厂不是 smoke-only wiring。
- 这刀直接服务 `LayeredDesignDocument -> canvas:design -> DesignCanvas -> model slot configs -> default worker/native providers -> standard JSON executor -> flat image analyzer -> extraction review` 主链；仍不新增 Tauri 命令、不新增旧 `poster_generate / canvas:poster / ImageTaskViewer`。
- 已验证：
  - `./node_modules/.bin/eslint "src/lib/layered-design/analyzerModelSlotAnalyzer.ts" "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/pages/design-canvas-smoke.tsx" "scripts/design-canvas-smoke.mjs" --max-warnings 0`
  - `./node_modules/.bin/vitest run "src/lib/layered-design/analyzerModelSlotAnalyzer.test.ts" "src/lib/layered-design/analyzerModelSlotTransport.test.ts" "src/lib/layered-design/analyzer.test.ts"`
  - `./node_modules/.bin/tsc -p "/tmp/lime-layered-design-tsconfig.json" --noEmit`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots --timeout-ms 240000 --interval-ms 1000`
  - `npm run smoke:design-canvas -- --analyzer worker-model-slots-native-ocr --timeout-ms 240000 --interval-ms 1000`
