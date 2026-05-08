# AI 图层化设计 HTTP JSON executor 接入协议

> 状态：current seam
> 更新时间：2026-05-08
> 适用对象：实现 subject matting、clean plate / inpaint、OCR TextLayer 的本地 sidecar 或远端模型服务。

## 1. 固定主链

真实模型服务只允许进入这条 current 主链：

```text
LayeredDesignDocument
  -> canvas:design
  -> DesignCanvas
  -> analyzer model slots
  -> standard JSON executor
  -> qualityContractValidation
  -> export-manifest.json evidence
```

不要新增 `poster_generate`、`canvas:poster`、`ImageTaskViewer`、provider adapter 或平行拆层 runtime。

## 2. HTTP 边界

服务端只需要实现一个 HTTP endpoint：

```text
POST <endpoint-url>
content-type: application/json
accept: application/json
```

前端入口：

```ts
createLayeredDesignFlatImageAnalyzerFromModelSlotHttpJsonExecutor(configs, {
  endpointUrl: "http://127.0.0.1:4455/model-slot",
});
```

接入前先跑 verifier：

```bash
node scripts/verify-layered-design-model-slot-http-json-executor.mjs \
  --endpoint-url "http://127.0.0.1:4455/model-slot"
```

verifier 会发送 `3` 个固定 synthetic poster profiles，而不是 1x1 占位图：

- `coffee-pop-up`：浅色活动海报，标题、主体、Logo、CTA 色块分区明确。
- `dark-game-poster`：深色高对比海报，用于覆盖暗背景与霓虹标题。
- `product-card`：商品卡片式构图，用于覆盖主体偏右、价格 / CTA / Logo 分散布局。

每个 profile 都会发送 `subject_matting / clean_plate / text_ocr` 三类 sample request，总计 `9` 个请求。verifier summary 会输出 `checkedProfiles`、`checkedKinds` 和 `checkedRequestCount`，用于接入前确认服务至少能处理接近海报拆层的多布局输入形态。

本地自测 verifier：

```bash
node scripts/verify-layered-design-model-slot-http-json-executor.mjs --self-test
```

启动一个独立本地 fixture endpoint，并用同一个 verifier 自检：

```bash
node scripts/layered-design-model-slot-http-json-fixture.mjs --self-test
```

该 fixture 是 standalone HTTP process，不在 GUI smoke 脚本内直接拼响应；它会按输入 profile / rect 生成 subject alpha PNG、mask PNG、clean plate PNG 和 OCR 文本 fixture，用于验证外部服务接入形态。默认 `worker-model-slots-http-json` GUI smoke 会启动这个 fixture process，再执行 `contract verifier -> browser HTTP POST -> export evidence check`。

生成 benchmark evidence JSON：

```bash
node scripts/benchmark-layered-design-model-slot-http-json-executor.mjs \
  --endpoint-url "http://127.0.0.1:4455/model-slot" \
  --output "/tmp/layered-design-model-slot-benchmark.json"
```

如果已经有真实 / 本地复杂样本，可以传入 sample manifest：

```bash
node scripts/benchmark-layered-design-model-slot-http-json-executor.mjs \
  --endpoint-url "http://127.0.0.1:4455/model-slot" \
  --sample-manifest "docs/roadmap/ai-layered-design/evidence/real-samples.json" \
  --output "/tmp/layered-design-model-slot-real-sample-benchmark.json"
```

sample manifest 最小结构：

```json
{
  "schemaVersion": "layered-design-model-slot-benchmark-samples@1",
  "samples": [
    {
      "id": "real-poster-001",
      "label": "真实复杂海报样本 001",
      "image": {
        "path": "samples/real-poster-001.png",
        "width": 900,
        "height": 1400,
        "mimeType": "image/png"
      },
      "subjectRect": { "x": 180, "y": 360, "width": 520, "height": 720 },
      "textRect": { "x": 90, "y": 84, "width": 560, "height": 120 }
    }
  ]
}
```

benchmark report 的 `completionGate.status=synthetic_only` 表示只跑了 synthetic profiles，不能当成真实复杂图质量完成；`sample_manifest_completed` 也只表示 endpoint contract 对真实样本字段满足，仍需要人工复核或后续 export evidence 附着。

完整目标最终验收还必须汇总真实 benchmark、人工复核、导出目录和外部设计工具打开证据：

```bash
cp docs/roadmap/ai-layered-design/evidence/completion-evidence.template.json \
  docs/roadmap/ai-layered-design/evidence/completion-evidence.json
cp docs/roadmap/ai-layered-design/evidence/design-tool-interoperability.template.json \
  docs/roadmap/ai-layered-design/evidence/design-tool-interoperability.json
node scripts/verify-layered-design-photopea-open.mjs \
  --psd "exports/real-sample.layered-design/trial.psd" \
  --psd-like-manifest "exports/real-sample.layered-design/psd-like-manifest.json" \
  --output "docs/roadmap/ai-layered-design/evidence/design-tool-interoperability.json"
node scripts/verify-layered-design-completion-evidence.mjs \
  --evidence "docs/roadmap/ai-layered-design/evidence/completion-evidence.json"
```

`verify-layered-design-photopea-open.mjs` 会通过 Photopea Web 工具真实打开 `trial.psd`，读取图层面板顺序、名称、可见性和 bounds，并写出外部工具 evidence；最终 completion verifier 不接受 synthetic-only、未人工 accepted、未写入导出 manifest、或缺少 Photoshop / Photopea / Figma 等外部工具截图记录的结果作为 `100%` 完成证据。

如果 `LayeredDesignDocument.extraction.analysis.modelSlotBenchmark` 写入 benchmark report，专业导出的 `export-manifest.json.evidence.modelSlotBenchmark` 会保留精简审计字段：

```json
{
  "schemaVersion": "layered-design-model-slot-benchmark@1",
  "createdAt": "2026-05-08T02:29:44.340Z",
  "mode": "synthetic_verifier_profiles",
  "checkedSamples": ["coffee-pop-up", "dark-game-poster", "product-card"],
  "checkedKinds": ["subject_matting", "clean_plate", "text_ocr"],
  "checkedRequestCount": 9,
  "completionGate": {
    "status": "synthetic_only",
    "missing": ["real_sample_manifest"]
  },
  "syntheticOnly": true,
  "sampleManifestProvided": false
}
```

导出 manifest 只保存 benchmark 审计摘要，不保存 endpoint URL，避免把本地 / 远端服务地址写入专业工程包。

把 benchmark report 写回 current 文档事实源时，使用纯函数边界：

```ts
const nextDocument = attachLayeredDesignModelSlotBenchmarkEvidence(document, {
  evidence: benchmarkReport,
});
```

该函数会先通过 `normalizeLayeredDesignModelSlotBenchmarkEvidence(...)` 校验 report，只接受 `synthetic_only` 或 `sample_manifest_completed` 两种 gate；无效 report 不会进入 `LayeredDesignDocument`。

GUI 三段式验收：

```bash
npm run smoke:design-canvas -- \
  --analyzer worker-model-slots-http-json \
  --timeout-ms 240000 \
  --interval-ms 1000
```

该 smoke 会执行：

```text
contract verifier -> browser HTTP POST -> export evidence check
```

## 3. 通用 request

每次请求都带：

```json
{
  "kind": "subject_matting | clean_plate | text_ocr",
  "input": {},
  "context": {
    "slotId": "smoke-subject-matting-slot",
    "slotKind": "subject_matting",
    "providerLabel": "Smoke model slot subject matting",
    "modelId": "smoke-subject-matting-slot-v1",
    "execution": "remote_model",
    "attempt": 1,
    "maxAttempts": 1,
    "timeoutMs": 45000,
    "fallbackStrategy": "return_null",
    "providerId": "smoke-model-slot",
    "metadata": {},
    "qualityContract": {
      "factSource": "LayeredDesignDocument.assets",
      "requiredResultFields": ["imageSrc", "maskSrc", "hasAlpha"],
      "requiredParamKeys": [
        "foregroundPixelCount",
        "detectedForegroundPixelCount",
        "ellipseFallbackApplied",
        "totalPixelCount"
      ],
      "reviewFindingIds": ["subject_model_slot_quality_metadata_missing"]
    }
  }
}
```

服务实现必须按 `kind` 分发，并原样遵守 `context.qualityContract`。

## 4. subject_matting

### Request input

```json
{
  "kind": "subject_matting",
  "input": {
    "image": {
      "src": "data:image/png;base64,...",
      "width": 900,
      "height": 1400,
      "mimeType": "image/png"
    },
    "createdAt": "2026-05-08T00:00:00.000Z",
    "subject": {
      "id": "subject-candidate",
      "name": "主体候选",
      "rect": { "x": 120, "y": 260, "width": 640, "height": 820 },
      "confidence": 0.9,
      "zIndex": 30,
      "crop": {
        "src": "data:image/png;base64,...",
        "width": 640,
        "height": 820,
        "mimeType": "image/png"
      }
    }
  }
}
```

### Required response

```json
{
  "kind": "subject_matting",
  "result": {
    "imageSrc": "data:image/png;base64,...",
    "maskSrc": "data:image/png;base64,...",
    "confidence": 0.96,
    "hasAlpha": true,
    "params": {
      "foregroundPixelCount": 18000,
      "detectedForegroundPixelCount": 17800,
      "ellipseFallbackApplied": false,
      "totalPixelCount": 20000
    }
  }
}
```

## 5. clean_plate

### Request input

```json
{
  "kind": "clean_plate",
  "input": {
    "image": {
      "src": "data:image/png;base64,...",
      "width": 900,
      "height": 1400,
      "mimeType": "image/png"
    },
    "createdAt": "2026-05-08T00:00:00.000Z",
    "subject": {
      "id": "subject-candidate",
      "name": "主体候选",
      "rect": { "x": 120, "y": 260, "width": 640, "height": 820 },
      "confidence": 0.9,
      "zIndex": 30,
      "crop": {
        "src": "data:image/png;base64,...",
        "width": 640,
        "height": 820,
        "mimeType": "image/png"
      },
      "maskSrc": "data:image/png;base64,..."
    }
  }
}
```

### Required response

```json
{
  "kind": "clean_plate",
  "result": {
    "src": "data:image/png;base64,...",
    "message": "clean plate ready",
    "params": {
      "filledPixelCount": 12000,
      "totalSubjectPixelCount": 12000,
      "maskApplied": true
    }
  }
}
```

## 6. text_ocr

### Request input

```json
{
  "kind": "text_ocr",
  "input": {
    "image": {
      "src": "data:image/png;base64,...",
      "width": 900,
      "height": 1400,
      "mimeType": "image/png"
    },
    "candidate": {
      "id": "headline-candidate",
      "name": "标题文字候选",
      "role": "text",
      "rect": { "x": 100, "y": 100, "width": 640, "height": 120 },
      "asset": {
        "id": "headline-raster",
        "kind": "text_raster",
        "src": "data:image/png;base64,...",
        "width": 640,
        "height": 120,
        "hasAlpha": true,
        "createdAt": "2026-05-08T00:00:00.000Z"
      }
    }
  }
}
```

### Required response

```json
{
  "kind": "text_ocr",
  "result": [
    {
      "text": "COFFEE POP-UP",
      "boundingBox": { "x": 8, "y": 10, "width": 420, "height": 64 },
      "confidence": 0.95
    }
  ]
}
```

## 7. 质量验收与导出 evidence

executor 返回后，Lime 会自动写入：

```json
{
  "params": {
    "qualityContractValidation": {
      "status": "satisfied",
      "factSource": "LayeredDesignDocument.assets",
      "requiredResultFields": ["src"],
      "requiredParamKeys": ["filledPixelCount", "totalSubjectPixelCount", "maskApplied"],
      "reviewFindingIds": ["clean_plate_model_slot_quality_metadata_missing"],
      "missingResultFields": [],
      "missingParamKeys": []
    },
    "modelSlotExecution": {
      "slotId": "smoke-clean-plate-slot",
      "slotKind": "clean_plate",
      "modelId": "smoke-clean-plate-slot-v1",
      "status": "succeeded"
    }
  }
}
```

导出后，`export-manifest.json.evidence` 会汇总：

```json
{
  "modelSlotExecutions": [],
  "modelSlotQualityValidations": []
}
```

生产服务必须让三类 validation 的 `status` 达到 `satisfied`，否则导出前会进入 review 或 high risk gate。

## 8. 错误处理

HTTP client 会把非 2xx 状态映射为 classified transport error：

| HTTP 状态 | transport code |
| --- | --- |
| 401 / 403 | `unauthorized` |
| 429 | `rate_limited` |
| 408 / 504 | `timeout` |
| 5xx | `remote_unavailable` |
| 其他非 2xx | `invalid_response` |

服务端不要返回 HTML 错误页；错误也应返回 JSON，便于排障。

## 9. 非目标

1. 本协议不是 provider adapter。
2. 本协议不新增 Tauri 命令。
3. 本协议不替代 `LayeredDesignDocument`。
4. 本协议不承诺任意扁平图完美拆成 Photoshop 原始图层。
5. 本协议不允许回流 `poster_generate / canvas:poster / ImageTaskViewer`。
