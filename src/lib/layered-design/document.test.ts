import { describe, expect, it } from "vitest";
import {
  attachLayeredDesignModelSlotBenchmarkEvidence,
  createImageLayer,
  createLayeredDesignDocument,
  createShapeLayer,
  createTextLayer,
  normalizeLayeredDesignDocument,
  normalizeLayeredDesignModelSlotBenchmarkEvidence,
  replaceImageLayerAsset,
  updateLayerTransform,
  updateTextLayerProperties,
} from "./document";
import type {
  DesignLayer,
  DesignLayerTransform,
  GeneratedDesignAsset,
  ImageLayer,
} from "./types";
import { LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION } from "./types";

const CREATED_AT = "2026-05-05T00:00:00.000Z";
const UPDATED_AT = "2026-05-05T01:00:00.000Z";

function createAsset(
  id: string,
  overrides: Partial<GeneratedDesignAsset> = {},
): GeneratedDesignAsset {
  return {
    id,
    kind: "subject",
    src: `/assets/${id}.png`,
    width: 512,
    height: 512,
    hasAlpha: true,
    provider: "test-provider",
    modelId: "test-image-model",
    prompt: "测试资产",
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function readTransform(layer: DesignLayer): DesignLayerTransform {
  return {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    rotation: layer.rotation,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
  };
}

function expectImageLayer(layer: DesignLayer | undefined): ImageLayer {
  expect(layer).toBeDefined();
  expect(layer?.type === "image" || layer?.type === "effect").toBe(true);
  return layer as ImageLayer;
}

describe("LayeredDesignDocument", () => {
  it("创建文档时应按 zIndex 稳定排序图层", () => {
    const background = createImageLayer({
      id: "background",
      name: "背景",
      type: "image",
      assetId: "asset-background",
      x: 0,
      y: 0,
      width: 1080,
      height: 1440,
      zIndex: 20,
    });
    const subject = createImageLayer({
      id: "subject",
      name: "主体",
      type: "image",
      assetId: "asset-subject",
      x: 100,
      y: 240,
      width: 720,
      height: 900,
      zIndex: 10,
    });
    const title = createTextLayer({
      id: "title",
      name: "标题",
      type: "text",
      text: "冥界女巫",
      x: 80,
      y: 80,
      width: 920,
      height: 120,
      zIndex: 30,
    });

    const document = createLayeredDesignDocument({
      id: "design-1",
      title: "测试海报",
      canvas: { width: 1080, height: 1440, backgroundColor: "#050505" },
      layers: [background, title, subject],
      createdAt: CREATED_AT,
    });

    expect(document.schemaVersion).toBe(
      LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION,
    );
    expect(document.layers.map((layer) => layer.id)).toEqual([
      "subject",
      "background",
      "title",
    ]);
  });

  it("普通文案应创建为 TextLayer 而不是图片层", () => {
    const textLayer = createTextLayer({
      id: "subtitle",
      name: "副标题",
      type: "text",
      text: "立即预约",
      x: 120,
      y: 1180,
      width: 640,
      height: 72,
    });

    expect(textLayer.type).toBe("text");
    expect(textLayer.text).toBe("立即预约");
    expect(textLayer.fontSize).toBe(24);
    expect(textLayer.color).toBe("#111111");
    expect(textLayer.align).toBe("left");
  });

  it("编辑 TextLayer 内容应回写文档、候选层和编辑历史", () => {
    const title = createTextLayer({
      id: "title",
      name: "标题",
      type: "text",
      text: "原始标题",
      x: 80,
      y: 96,
      width: 720,
      height: 120,
      fontSize: 48,
      color: "#111111",
      align: "left",
      zIndex: 4,
      source: "extracted",
    });
    const document = createLayeredDesignDocument({
      id: "design-text-edit",
      title: "文字编辑",
      canvas: { width: 1080, height: 1440 },
      layers: [title],
      extraction: {
        sourceAssetId: "asset-source",
        backgroundLayerId: "background",
        candidates: [
          {
            id: "ocr-title",
            role: "text",
            confidence: 0.91,
            selected: true,
            layer: title,
          },
        ],
      },
      preview: {
        assetId: "asset-preview",
        src: "/preview.png",
        width: 1080,
        height: 1440,
        updatedAt: CREATED_AT,
        stale: false,
      },
      createdAt: CREATED_AT,
    });

    const updated = updateTextLayerProperties(document, {
      layerId: "title",
      text: "可编辑标题",
      fontSize: 64,
      color: "#f97316",
      align: "center",
      editId: "edit-title-text",
      editedAt: UPDATED_AT,
    });

    expect(updated.layers[0]).toMatchObject({
      id: "title",
      type: "text",
      text: "可编辑标题",
      fontSize: 64,
      color: "#f97316",
      align: "center",
    });
    expect(updated.extraction?.candidates[0]?.layer).toMatchObject({
      id: "title",
      type: "text",
      text: "可编辑标题",
      fontSize: 64,
    });
    expect(updated.preview).toMatchObject({ stale: true });
    expect(updated.editHistory.at(-1)).toMatchObject({
      id: "edit-title-text",
      type: "text_updated",
      layerId: "title",
      previousText: "原始标题",
      nextText: "可编辑标题",
      previousFontSize: 48,
      nextFontSize: 64,
      previousColor: "#111111",
      nextColor: "#f97316",
      previousAlign: "left",
      nextAlign: "center",
    });
  });

  it("单层替换 asset 时不应改变 layer id、transform、zIndex 和锁定态", () => {
    const originalLayer = createImageLayer({
      id: "subject",
      name: "角色",
      type: "image",
      assetId: "asset-old",
      x: 140,
      y: 220,
      width: 640,
      height: 860,
      rotation: -4,
      opacity: 0.82,
      zIndex: 8,
      visible: true,
      locked: true,
      source: "generated",
    });
    const document = createLayeredDesignDocument({
      id: "design-asset-replace",
      title: "单层替换",
      canvas: { width: 1080, height: 1440 },
      layers: [originalLayer],
      assets: [createAsset("asset-old")],
      createdAt: CREATED_AT,
    });

    const updated = replaceImageLayerAsset(document, {
      layerId: "subject",
      asset: createAsset("asset-new", { prompt: "新的角色姿态" }),
      editId: "edit-replace-subject",
      editedAt: UPDATED_AT,
    });

    const updatedLayer = expectImageLayer(
      updated.layers.find((layer) => layer.id === "subject"),
    );
    expect(updatedLayer.id).toBe(originalLayer.id);
    expect(updatedLayer.assetId).toBe("asset-new");
    expect(readTransform(updatedLayer)).toEqual(readTransform(originalLayer));
    expect(updatedLayer.visible).toBe(true);
    expect(updatedLayer.locked).toBe(true);
    expect(document.layers[0]).toEqual(originalLayer);
    expect(updated.assets.map((asset) => asset.id)).toEqual([
      "asset-old",
      "asset-new",
    ]);
    expect(updated.editHistory.at(-1)).toMatchObject({
      id: "edit-replace-subject",
      type: "asset_replaced",
      previousAssetId: "asset-old",
      nextAssetId: "asset-new",
    });
  });

  it("normalize 应填充图层编辑所需的默认状态", () => {
    const document = normalizeLayeredDesignDocument({
      id: "design-normalize",
      title: "归一化",
      canvas: { width: 1200, height: 1600 },
      layers: [
        {
          id: "cta-bg",
          name: "按钮底",
          type: "shape",
          x: 160,
          y: 1320,
          width: 520,
          height: 96,
        },
      ],
      createdAt: CREATED_AT,
    });

    const shapeLayer = document.layers[0];
    expect(shapeLayer).toEqual(
      createShapeLayer({
        id: "cta-bg",
        name: "按钮底",
        type: "shape",
        x: 160,
        y: 1320,
        width: 520,
        height: 96,
      }),
    );
    expect(shapeLayer.visible).toBe(true);
    expect(shapeLayer.locked).toBe(false);
    expect(shapeLayer.opacity).toBe(1);
    expect(shapeLayer.rotation).toBe(0);
    expect(shapeLayer.zIndex).toBe(0);
  });

  it("preview 只应作为导出投影，不应进入 layers 事实源", () => {
    const document = createLayeredDesignDocument({
      id: "design-preview",
      title: "预览投影",
      canvas: { width: 1080, height: 1440 },
      layers: [
        createImageLayer({
          id: "subject",
          name: "主体",
          type: "image",
          assetId: "asset-subject",
          x: 120,
          y: 240,
          width: 720,
          height: 860,
          zIndex: 1,
        }),
      ],
      assets: [
        createAsset("asset-subject"),
        createAsset("asset-preview", {
          kind: "preview",
          src: "/previews/latest.png",
          hasAlpha: false,
        }),
      ],
      preview: {
        assetId: "asset-preview",
        src: "/previews/latest.png",
        width: 1080,
        height: 1440,
        updatedAt: CREATED_AT,
      },
      createdAt: CREATED_AT,
    });

    expect(document.preview).toMatchObject({
      assetId: "asset-preview",
      stale: false,
    });
    expect(document.layers.map((layer) => layer.id)).toEqual(["subject"]);
    expect(document.layers.some((layer) => layer.id === "asset-preview")).toBe(
      false,
    );

    const updated = updateLayerTransform(document, {
      layerId: "subject",
      transform: { x: 180, zIndex: 4 },
      editId: "edit-move-subject",
      editedAt: UPDATED_AT,
    });

    expect(updated.preview).toMatchObject({
      assetId: "asset-preview",
      stale: true,
    });
    expect(updated.layers.map((layer) => layer.id)).toEqual(["subject"]);
    expect(updated.layers[0].x).toBe(180);
    expect(updated.layers[0].zIndex).toBe(4);
  });

  it("应标准化并附着 model slot benchmark evidence 到 extraction analysis", () => {
    const document = createLayeredDesignDocument({
      id: "benchmark-document",
      title: "Benchmark 文档",
      canvas: { width: 1080, height: 1440 },
      extraction: {
        sourceAssetId: "flat-source",
        analysis: {
          analyzer: {
            kind: "structured_pipeline",
            label: "HTTP JSON model slot analyzer",
          },
          outputs: {
            candidateRaster: true,
            candidateMask: true,
            cleanPlate: true,
            ocrText: true,
          },
        },
      },
      assets: [
        createAsset("flat-source", {
          hasAlpha: false,
        }),
      ],
      createdAt: CREATED_AT,
    });
    const rawEvidence = {
      schemaVersion: "layered-design-model-slot-benchmark@1",
      createdAt: "2026-05-08T02:29:44.340Z",
      endpointUrl: "http://127.0.0.1:4455/model-slot",
      benchmark: {
        mode: "sample_manifest",
        checkedSamples: ["real-poster-001"],
        checkedKinds: ["subject_matting", "clean_plate", "text_ocr"],
        checkedRequestCount: 3,
        sampleManifestPath: "/tmp/real-samples.json",
      },
      completionGate: {
        status: "sample_manifest_completed",
        missing: [
          "human_review_or_complex_sample_quality_evidence",
          "export_manifest_evidence_attachment",
        ],
      },
    };

    const normalized =
      normalizeLayeredDesignModelSlotBenchmarkEvidence(rawEvidence);
    const updated = attachLayeredDesignModelSlotBenchmarkEvidence(document, {
      evidence: rawEvidence,
      editId: "attach-benchmark",
      appliedAt: UPDATED_AT,
    });

    expect(normalized).toEqual(rawEvidence);
    expect(updated.extraction?.analysis?.modelSlotBenchmark).toEqual(
      rawEvidence,
    );
    expect(updated.editHistory.at(-1)).toMatchObject({
      id: "attach-benchmark",
      type: "extraction_reanalyzed",
      actor: "system",
      summary:
        "附着 model slot benchmark evidence: sample_manifest_completed",
      createdAt: UPDATED_AT,
    });
    expect(updated.updatedAt).toBe(UPDATED_AT);
  });

  it("无效 benchmark evidence 不应进入文档事实源", () => {
    const invalidEvidence = {
      schemaVersion: "layered-design-model-slot-benchmark@1",
      createdAt: "2026-05-08T02:29:44.340Z",
      benchmark: {
        mode: "synthetic_verifier_profiles",
        checkedSamples: ["coffee-pop-up"],
        checkedKinds: ["subject_matting"],
        checkedRequestCount: 1,
      },
      completionGate: {
        status: "complete",
        missing: [],
      },
    };
    const document = createLayeredDesignDocument({
      id: "benchmark-invalid",
      title: "Benchmark 无效",
      canvas: { width: 1080, height: 1440 },
      extraction: {
        sourceAssetId: "flat-source",
        analysis: {
          analyzer: {
            kind: "structured_pipeline",
            label: "HTTP JSON model slot analyzer",
          },
        },
      },
      createdAt: CREATED_AT,
    });

    expect(
      normalizeLayeredDesignModelSlotBenchmarkEvidence(invalidEvidence),
    ).toBeUndefined();
    expect(() =>
      attachLayeredDesignModelSlotBenchmarkEvidence(document, {
        evidence: invalidEvidence,
      }),
    ).toThrow("无效 model slot benchmark evidence");
  });
});
