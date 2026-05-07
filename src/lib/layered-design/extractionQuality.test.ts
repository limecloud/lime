import { describe, expect, it } from "vitest";
import { createImageLayer, createTextLayer } from "./document";
import { evaluateLayeredDesignExtractionQuality } from "./extractionQuality";
import type { LayeredDesignExtraction } from "./types";

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
});
