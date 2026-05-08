import { describe, expect, it } from "vitest";
import { createImageLayer, createTextLayer } from "./document";
import { evaluateLayeredDesignExtractionQuality } from "./extractionQuality";
import type { GeneratedDesignAsset, LayeredDesignExtraction } from "./types";

function createBaseExtraction(
  overrides: Partial<LayeredDesignExtraction> = {},
): LayeredDesignExtraction {
  return {
    sourceAssetId: "source-asset",
    backgroundLayerId: "background-layer",
    candidateSelectionThreshold: 0.6,
    review: {
      status: "pending",
    },
    analysis: {
      analyzer: {
        kind: "structured_pipeline",
        label: "测试 analyzer",
      },
      outputs: {
        candidateRaster: true,
        candidateMask: true,
        cleanPlate: true,
        ocrText: true,
      },
      generatedAt: "2026-05-07T00:00:00.000Z",
    },
    cleanPlate: {
      status: "succeeded",
      assetId: "clean-plate-asset",
    },
    candidates: [
      {
        id: "subject-candidate",
        role: "subject",
        confidence: 0.92,
        selected: true,
        layer: createImageLayer({
          id: "subject-layer",
          name: "人物主体",
          type: "image",
          assetId: "subject-asset",
          maskAssetId: "subject-mask",
          alphaMode: "mask",
          x: 120,
          y: 220,
          width: 760,
          height: 980,
          zIndex: 20,
          source: "extracted",
        }),
        assetIds: ["subject-asset", "subject-mask"],
      },
      {
        id: "headline-candidate",
        role: "text",
        confidence: 0.88,
        selected: true,
        layer: createTextLayer({
          id: "headline-layer",
          name: "标题文案",
          type: "text",
          text: "霓虹开幕",
          x: 148,
          y: 104,
          width: 720,
          height: 156,
          zIndex: 38,
          fontSize: 72,
          color: "#f97316",
          align: "center",
          source: "extracted",
        }),
        assetIds: [],
      },
    ],
    ...overrides,
  };
}

describe("evaluateLayeredDesignExtractionQuality", () => {
  it("mask、clean plate 和 OCR 都可用时应判定可进入编辑", () => {
    const assessment = evaluateLayeredDesignExtractionQuality(
      createBaseExtraction(),
    );

    expect(assessment).toMatchObject({
      score: 100,
      level: "ready",
      label: "可进入编辑",
      selectedCandidateCount: 2,
      totalCandidateCount: 2,
      findings: [],
    });
    expect(assessment.summary).toContain("拆层结果基本可进入编辑");
  });

  it("主体缺 mask 且 clean plate 失败时应判定高风险", () => {
    const assessment = evaluateLayeredDesignExtractionQuality(
      createBaseExtraction({
        analysis: {
          analyzer: {
            kind: "local_heuristic",
            label: "本地 heuristic analyzer",
          },
          outputs: {
            candidateRaster: true,
            candidateMask: false,
            cleanPlate: false,
            ocrText: false,
          },
        },
        cleanPlate: {
          status: "failed",
          message: "修补失败。",
        },
        candidates: [
          {
            id: "subject-candidate",
            role: "subject",
            confidence: 0.92,
            selected: true,
            layer: createImageLayer({
              id: "subject-layer",
              name: "人物主体",
              type: "image",
              assetId: "subject-asset",
              alphaMode: "embedded",
              x: 120,
              y: 220,
              width: 760,
              height: 980,
              zIndex: 20,
              source: "extracted",
            }),
            assetIds: ["subject-asset"],
          },
        ],
      }),
    );

    expect(assessment.level).toBe("high_risk");
    expect(assessment.score).toBeLessThan(50);
    expect(assessment.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "subject_mask_missing",
        "clean_plate_missing",
        "ocr_text_missing",
      ]),
    );
  });

  it("实验能力或低置信候选进入选择时应要求人工复核", () => {
    const assessment = evaluateLayeredDesignExtractionQuality(
      createBaseExtraction({
        analysis: {
          analyzer: {
            kind: "structured_pipeline",
            label: "测试 analyzer",
          },
          outputs: {
            candidateRaster: true,
            candidateMask: true,
            cleanPlate: true,
            ocrText: true,
          },
          providerCapabilities: [
            {
              kind: "clean_plate",
              label: "实验 clean plate",
              execution: "browser_worker",
              modelId: "simple_neighbor_inpaint_v1",
              supports: {
                dataUrlPng: true,
                maskInput: true,
                cleanPlateOutput: true,
              },
              quality: {
                productionReady: false,
                deterministic: true,
                requiresHumanReview: true,
              },
            },
          ],
        },
        candidates: [
          ...createBaseExtraction().candidates,
          {
            id: "fragment-candidate",
            role: "background_fragment",
            confidence: 0.24,
            selected: true,
            issues: ["low_confidence"],
            layer: createImageLayer({
              id: "fragment-layer",
              name: "边角碎片",
              type: "image",
              assetId: "fragment-asset",
              alphaMode: "embedded",
              x: 32,
              y: 40,
              width: 120,
              height: 120,
              zIndex: 30,
              source: "extracted",
            }),
            assetIds: ["fragment-asset"],
          },
        ],
      }),
    );

    expect(assessment.level).toBe("review");
    expect(assessment.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "low_confidence_selected",
        "provider_requires_review",
      ]),
    );
  });

  it("应消费 matting 与 clean plate 后处理元数据提示质量复核点", () => {
    const extraction = createBaseExtraction();
    const assets: GeneratedDesignAsset[] = [
      {
        id: "subject-asset",
        kind: "subject",
        src: "data:image/png;base64,subject",
        width: 760,
        height: 980,
        hasAlpha: true,
        createdAt: "2026-05-07T00:00:00.000Z",
        params: {
          alphaHoleFilledPixelCount: 180,
          totalPixelCount: 760 * 980,
        },
      },
      {
        id: "clean-plate-asset",
        kind: "clean_plate",
        src: "data:image/png;base64,clean",
        width: 1080,
        height: 1440,
        hasAlpha: false,
        createdAt: "2026-05-07T00:00:00.000Z",
        params: {
          haloExpandedPixelCount: 24,
          totalSubjectPixelCount: 9200,
        },
      },
    ];

    const assessment = evaluateLayeredDesignExtractionQuality(extraction, {
      assets,
    });

    expect(assessment.level).toBe("review");
    expect(assessment.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "subject_alpha_holes_repaired",
        "clean_plate_halo_repaired",
      ]),
    );
    expect(assessment.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "subject_alpha_holes_repaired",
          severity: "info",
          message: expect.stringContaining("180 个主体透明孔洞像素"),
        }),
        expect.objectContaining({
          id: "clean_plate_halo_repaired",
          severity: "warning",
          message: expect.stringContaining("24 个 mask 边缘 halo 像素"),
        }),
      ]),
    );
  });

  it("应消费 subject matting 前景覆盖率元数据识别异常 mask", () => {
    const extraction = createBaseExtraction();
    const assets: GeneratedDesignAsset[] = [
      {
        id: "subject-asset",
        kind: "subject",
        src: "data:image/png;base64,subject",
        width: 760,
        height: 980,
        hasAlpha: true,
        createdAt: "2026-05-07T00:00:00.000Z",
        params: {
          foregroundPixelCount: 12,
          totalPixelCount: 760 * 980,
        },
      },
    ];

    const assessment = evaluateLayeredDesignExtractionQuality(extraction, {
      assets,
    });

    expect(assessment.level).toBe("high_risk");
    expect(assessment.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "subject_mask_coverage_extreme",
          severity: "critical",
          message: expect.stringContaining("前景覆盖约 0%"),
        }),
      ]),
    );
  });

  it("应把 subject matting 椭圆兜底识别为高风险猜测 mask", () => {
    const extraction = createBaseExtraction();
    const assets: GeneratedDesignAsset[] = [
      {
        id: "subject-asset",
        kind: "subject",
        src: "data:image/png;base64,subject",
        width: 760,
        height: 980,
        hasAlpha: true,
        createdAt: "2026-05-07T00:00:00.000Z",
        params: {
          foregroundPixelCount: 372_400,
          detectedForegroundPixelCount: 0,
          ellipseFallbackApplied: true,
          totalPixelCount: 760 * 980,
        },
      },
    ];

    const assessment = evaluateLayeredDesignExtractionQuality(extraction, {
      assets,
    });

    expect(assessment.level).toBe("high_risk");
    expect(assessment.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "subject_mask_ellipse_fallback",
          severity: "critical",
          message: expect.stringContaining("检测前景覆盖约 0%"),
        }),
      ]),
    );
  });

  it("应消费 clean plate 修补覆盖元数据识别假成功背景修补", () => {
    const extraction = createBaseExtraction();
    const assets: GeneratedDesignAsset[] = [
      {
        id: "clean-plate-asset",
        kind: "clean_plate",
        src: "data:image/png;base64,clean",
        width: 1080,
        height: 1440,
        hasAlpha: false,
        createdAt: "2026-05-07T00:00:00.000Z",
        params: {
          filledPixelCount: 0,
          totalSubjectPixelCount: 9_200,
          maskApplied: false,
        },
      },
    ];

    const assessment = evaluateLayeredDesignExtractionQuality(extraction, {
      assets,
    });

    expect(assessment.level).toBe("high_risk");
    expect(assessment.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "clean_plate_fill_coverage_low",
          severity: "critical",
          message: expect.stringContaining("0/9200 个目标像素"),
        }),
        expect.objectContaining({
          id: "clean_plate_mask_not_applied",
          severity: "warning",
        }),
      ]),
    );
  });

  it("生产级 model slot 缺少质量元数据时应要求人工复核", () => {
    const extraction = createBaseExtraction({
      analysis: {
        analyzer: {
          kind: "structured_pipeline",
          label: "生产 model slot analyzer",
        },
        outputs: {
          candidateRaster: true,
          candidateMask: true,
          cleanPlate: true,
          ocrText: true,
        },
        providerCapabilities: [
          {
            kind: "subject_matting",
            label: "生产主体抠图 slot",
            execution: "remote_model",
            modelId: "prod-matting-v1",
            supports: {
              dataUrlPng: true,
              alphaOutput: true,
              maskOutput: true,
            },
            quality: {
              productionReady: true,
              requiresHumanReview: false,
            },
          },
          {
            kind: "clean_plate",
            label: "生产 clean plate slot",
            execution: "remote_model",
            modelId: "prod-inpaint-v1",
            supports: {
              dataUrlPng: true,
              maskInput: true,
              cleanPlateOutput: true,
            },
            quality: {
              productionReady: true,
              requiresHumanReview: false,
            },
          },
        ],
      },
    });
    const assets: GeneratedDesignAsset[] = [
      {
        id: "subject-asset",
        kind: "subject",
        src: "data:image/png;base64,subject",
        width: 760,
        height: 980,
        hasAlpha: true,
        createdAt: "2026-05-07T00:00:00.000Z",
        params: {
          modelSlotExecution: {
            slotId: "subject-slot",
            slotKind: "subject_matting",
            modelId: "prod-matting-v1",
            status: "succeeded",
          },
        },
      },
      {
        id: "clean-plate-asset",
        kind: "clean_plate",
        src: "data:image/png;base64,clean",
        width: 1080,
        height: 1440,
        hasAlpha: false,
        createdAt: "2026-05-07T00:00:00.000Z",
        params: {
          modelSlotExecution: {
            slotId: "clean-slot",
            slotKind: "clean_plate",
            modelId: "prod-inpaint-v1",
            status: "succeeded",
          },
        },
      },
    ];

    const assessment = evaluateLayeredDesignExtractionQuality(extraction, {
      assets,
    });

    expect(assessment.level).toBe("review");
    expect(assessment.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "subject_model_slot_quality_metadata_missing",
          severity: "warning",
          message: expect.stringContaining("foregroundPixelCount"),
        }),
        expect.objectContaining({
          id: "clean_plate_model_slot_quality_metadata_missing",
          severity: "warning",
          message: expect.stringContaining("filledPixelCount"),
        }),
      ]),
    );
  });

  it("生产级 model slot 提供完整质量元数据时应保持 ready", () => {
    const extraction = createBaseExtraction({
      analysis: {
        analyzer: {
          kind: "structured_pipeline",
          label: "生产 model slot analyzer",
        },
        outputs: {
          candidateRaster: true,
          candidateMask: true,
          cleanPlate: true,
          ocrText: true,
        },
        providerCapabilities: [
          {
            kind: "subject_matting",
            label: "生产主体抠图 slot",
            execution: "remote_model",
            modelId: "prod-matting-v1",
            supports: {
              dataUrlPng: true,
              alphaOutput: true,
              maskOutput: true,
            },
            quality: {
              productionReady: true,
              requiresHumanReview: false,
            },
          },
          {
            kind: "clean_plate",
            label: "生产 clean plate slot",
            execution: "remote_model",
            modelId: "prod-inpaint-v1",
            supports: {
              dataUrlPng: true,
              maskInput: true,
              cleanPlateOutput: true,
            },
            quality: {
              productionReady: true,
              requiresHumanReview: false,
            },
          },
        ],
      },
    });
    const assets: GeneratedDesignAsset[] = [
      {
        id: "subject-asset",
        kind: "subject",
        src: "data:image/png;base64,subject",
        width: 760,
        height: 980,
        hasAlpha: true,
        createdAt: "2026-05-07T00:00:00.000Z",
        params: {
          foregroundPixelCount: 312_000,
          detectedForegroundPixelCount: 312_000,
          ellipseFallbackApplied: false,
          totalPixelCount: 760 * 980,
          modelSlotExecution: {
            slotId: "subject-slot",
            slotKind: "subject_matting",
            modelId: "prod-matting-v1",
            status: "succeeded",
          },
        },
      },
      {
        id: "clean-plate-asset",
        kind: "clean_plate",
        src: "data:image/png;base64,clean",
        width: 1080,
        height: 1440,
        hasAlpha: false,
        createdAt: "2026-05-07T00:00:00.000Z",
        params: {
          filledPixelCount: 9_200,
          totalSubjectPixelCount: 9_200,
          haloExpandedPixelCount: 0,
          maskApplied: true,
          modelSlotExecution: {
            slotId: "clean-slot",
            slotKind: "clean_plate",
            modelId: "prod-inpaint-v1",
            status: "succeeded",
          },
        },
      },
    ];

    const assessment = evaluateLayeredDesignExtractionQuality(extraction, {
      assets,
    });

    expect(assessment).toMatchObject({
      score: 100,
      level: "ready",
      findings: [],
    });
  });
});
