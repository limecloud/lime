# AI 图层化设计真实样本人工复核 Rubric

> 用途：真实 endpoint 跑完 `benchmark-layered-design-model-slot-http-json-executor.mjs --sample-manifest ...` 后，人工复核每个样本是否能支持“完整类 Lovart 产品目标”的质量判断。该文件不是 synthetic smoke 的替代品，必须配合真实图片、真实 endpoint 和导出 evidence 使用。

## 1. 复核前置条件

- 已准备 `real-samples.template.json` 的真实副本，且 `samples/*.png` 指向真实复杂图片。
- 已执行 benchmark：

```bash
node scripts/benchmark-layered-design-model-slot-http-json-executor.mjs \
  --endpoint-url "http://127.0.0.1:4455/model-slot" \
  --sample-manifest "docs/roadmap/ai-layered-design/evidence/real-samples.json" \
  --output "docs/roadmap/ai-layered-design/evidence/model-slot-benchmark.real.json"
```

- 已用 `attachLayeredDesignModelSlotBenchmarkEvidence(...)` 把 benchmark report 写回实际 `LayeredDesignDocument`。
- 已导出工程包，并确认 `export-manifest.json.evidence.modelSlotBenchmark.completionGate.status = "sample_manifest_completed"`。

## 2. 每样本评分项

每个样本按 `0 / 1 / 2` 评分：

| 维度 | 0 分 | 1 分 | 2 分 |
| --- | --- | --- | --- |
| subject matting | 主体明显缺失、背景大面积误入、边缘硬切不可用 | 主体基本可用，但细节/边缘需要人工修 | 主体独立成层，边缘自然，可直接进入设计编辑 |
| clean plate / inpaint | 主体区域缺洞、明显脏块、无法作为背景 | 大体补齐，但有可见 halo / 纹理断裂 | 背景连续，移动主体后不明显穿帮 |
| OCR / TextLayer | 核心文字识别失败或位置不可用 | 核心词可读，但有错字、漏字或框选偏移 | 文字内容和框选足以生成可编辑 TextLayer |
| layer separation | Logo/CTA/背景碎片与主体严重混淆 | 主要层可用，次要元素需人工整理 | 主体、文字、Logo/CTA、背景语义分离清晰 |
| export evidence | benchmark 或质量信息未进入导出包 | evidence 存在但缺人工结论或样本映射 | export manifest、psd-like manifest、人工复核记录一致 |

## 3. 通过门槛

- 每个样本总分最高 `10` 分。
- 单样本 `< 7` 分：不能算 ready，必须进入 review。
- 样本集中任一高风险类型全失败：不能宣称完整类 Lovart 目标完成。
- 所有样本 `>= 8` 分，且没有 subject / clean plate / OCR 任一维度为 `0`，才可把“复杂图质量 benchmark”从未完成改为已完成。

## 4. 复核记录模板

```json
{
  "schemaVersion": "layered-design-real-sample-review@1",
  "reviewedAt": "2026-05-08T00:00:00.000Z",
  "benchmarkReport": "model-slot-benchmark.real.json",
  "samples": [
    {
      "id": "real-poster-multi-subject-001",
      "scores": {
        "subjectMatting": 0,
        "cleanPlate": 0,
        "ocrTextLayer": 0,
        "layerSeparation": 0,
        "exportEvidence": 0
      },
      "decision": "review",
      "notes": "填写人工观察结论；只有达到通过门槛后才改为 accepted"
    }
  ]
}
```

完成前还必须把复核记录、真实 benchmark、导出目录和外部设计工具打开证据汇总到
`completion-evidence.json`，并执行：

```bash
node scripts/verify-layered-design-completion-evidence.mjs \
  --evidence "docs/roadmap/ai-layered-design/evidence/completion-evidence.json"
```

该 verifier 会拒绝 synthetic-only benchmark、低于 `8` 分或关键维度为 `0` 的样本、
缺少 `export-manifest.json.evidence.modelSlotBenchmark` 的导出目录，以及没有截图/记录的外部工具打开结论。
