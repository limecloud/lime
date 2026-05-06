import { describe, expect, it } from "vitest";
import { normalizeLayeredDesignDocument } from "./document";
import {
  createLayeredDesignExtractionDocument,
  updateLayeredDesignExtractionSelection,
} from "./extraction";
import type { GeneratedDesignAsset, LayeredDesignDocument } from "./types";

const CREATED_AT = "2026-05-06T00:00:00.000Z";
const UPDATED_AT = "2026-05-06T01:00:00.000Z";

function createAsset(
  id: string,
  overrides: Partial<GeneratedDesignAsset> = {},
): GeneratedDesignAsset {
  return {
    id,
    kind: "subject",
    src: `data:image/png;base64,${id}`,
    width: 512,
    height: 512,
    hasAlpha: true,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function createExtractionDocument(): LayeredDesignDocument {
  return createLayeredDesignExtractionDocument({
    id: "flat-poster-design",
    title: "扁平海报拆层",
    canvas: {
      width: 1080,
      height: 1440,
      backgroundColor: "#050505",
    },
    sourceAsset: createAsset("flat-source", {
      kind: "background",
      src: "https://example.com/poster.png",
      width: 1080,
      height: 1440,
      hasAlpha: false,
    }),
    cleanPlate: {
      asset: createAsset("clean-plate", {
        kind: "clean_plate",
        src: "data:image/png;base64,clean",
        width: 1080,
        height: 1440,
        hasAlpha: false,
      }),
    },
    candidates: [
      {
        id: "subject-candidate",
        role: "subject",
        confidence: 0.92,
        layer: {
          id: "subject-layer",
          name: "人物主体",
          type: "image",
          assetId: "subject-asset",
          maskAssetId: "subject-mask",
          x: 160,
          y: 240,
          width: 760,
          height: 980,
          zIndex: 20,
          alphaMode: "mask",
        },
        assets: [
          createAsset("subject-asset"),
          createAsset("subject-mask", {
            kind: "mask",
            hasAlpha: false,
          }),
        ],
      },
      {
        id: "logo-candidate",
        role: "logo",
        confidence: 0.31,
        layer: {
          id: "logo-layer",
          name: "艺术 Logo",
          type: "image",
          assetId: "logo-asset",
          x: 96,
          y: 96,
          width: 420,
          height: 180,
          zIndex: 40,
          alphaMode: "embedded",
        },
        assets: [
          createAsset("logo-asset", {
            kind: "logo",
            width: 420,
            height: 180,
          }),
        ],
      },
    ],
    createdAt: CREATED_AT,
  });
}

describe("LayeredDesign extraction draft", () => {
  it("normalize 应吸收 extraction 附带资产并强制候选层来源为 extracted", () => {
    const document = normalizeLayeredDesignDocument({
      id: "normalize-extraction",
      title: "拆层归一化",
      canvas: { width: 1080, height: 1440 },
      layers: [],
      extraction: {
        sourceAssetId: "flat-source",
        cleanPlate: {
          asset: createAsset("clean-plate", {
            kind: "clean_plate",
            width: 1080,
            height: 1440,
            hasAlpha: false,
          }),
        },
        candidates: [
          {
            id: "subject-candidate",
            role: "subject",
            confidence: 81,
            layer: {
              id: "subject-layer",
              name: "人物主体",
              type: "image",
              assetId: "subject-asset",
              x: 0,
              y: 0,
              width: 320,
              height: 640,
            },
            assets: [createAsset("subject-asset")],
          },
        ],
      },
      assets: [
        createAsset("flat-source", {
          kind: "source_image",
          width: 1080,
          height: 1440,
          hasAlpha: false,
        }),
      ],
      createdAt: CREATED_AT,
    });

    expect(document.assets.map((asset) => asset.id)).toEqual([
      "flat-source",
      "clean-plate",
      "subject-asset",
    ]);
    expect(document.extraction?.candidates[0]).toMatchObject({
      confidence: 0.81,
      selected: true,
      assetIds: ["subject-asset"],
    });
    expect(document.extraction?.candidates[0].layer.source).toBe("extracted");
  });

  it("应把扁平图拆层结果归一为 LayeredDesignDocument，并让背景优先落 clean plate", () => {
    const document = createExtractionDocument();

    expect(document.assets.find((asset) => asset.id === "flat-source")?.kind).toBe(
      "source_image",
    );
    expect(document.extraction?.cleanPlate).toMatchObject({
      status: "succeeded",
      assetId: "clean-plate",
    });
    expect(document.layers.map((layer) => layer.id)).toEqual([
      "extraction-background-image",
      "subject-layer",
    ]);

    const backgroundLayer = document.layers[0];
    expect(backgroundLayer).toMatchObject({
      id: "extraction-background-image",
      source: "extracted",
      assetId: "clean-plate",
    });
  });

  it("低置信度候选层默认不选中，且不会静默进入正式图层", () => {
    const document = createExtractionDocument();
    const logoCandidate = document.extraction?.candidates.find(
      (candidate) => candidate.id === "logo-candidate",
    );

    expect(logoCandidate).toMatchObject({
      selected: false,
      issues: ["low_confidence"],
    });
    expect(document.layers.some((layer) => layer.id === "logo-layer")).toBe(
      false,
    );
  });

  it("更新候选选择时应只把选中候选层同步进正式图层", () => {
    const document = createExtractionDocument();
    const updated = updateLayeredDesignExtractionSelection(document, {
      selectedCandidateIds: ["subject-candidate", "logo-candidate"],
      editId: "edit-select-candidates",
      editedAt: UPDATED_AT,
    });

    expect(updated.layers.map((layer) => layer.id)).toEqual([
      "extraction-background-image",
      "subject-layer",
      "logo-layer",
    ]);
    expect(
      updated.extraction?.candidates.find(
        (candidate) => candidate.id === "logo-candidate",
      ),
    ).toMatchObject({
      selected: true,
      issues: ["low_confidence"],
    });
    expect(updated.editHistory.at(-1)).toMatchObject({
      id: "edit-select-candidates",
      type: "candidate_selection_updated",
    });
  });

  it("clean plate 失败时仍应保留原始扁平图背景，继续进入可编辑工程", () => {
    const document = createLayeredDesignExtractionDocument({
      id: "flat-poster-without-clean-plate",
      title: "无 clean plate",
      canvas: { width: 1080, height: 1440 },
      sourceAsset: createAsset("flat-source", {
        kind: "background",
        src: "https://example.com/flat.png",
        width: 1080,
        height: 1440,
        hasAlpha: false,
      }),
      cleanPlate: {
        status: "failed",
        message: "修补失败，保留原图背景。",
      },
      candidates: [
        {
          id: "subject-candidate",
          role: "subject",
          selected: true,
          confidence: 0.88,
          layer: {
            id: "subject-layer",
            name: "主体",
            type: "image",
            assetId: "subject-asset",
            x: 120,
            y: 220,
            width: 760,
            height: 980,
            zIndex: 10,
            alphaMode: "embedded",
          },
          assets: [createAsset("subject-asset")],
        },
      ],
      createdAt: CREATED_AT,
    });

    expect(document.extraction?.cleanPlate).toMatchObject({
      status: "failed",
      message: "修补失败，保留原图背景。",
    });
    expect(document.layers.map((layer) => layer.id)).toEqual([
      "extraction-background-image",
      "subject-layer",
    ]);
    expect(document.layers[0]).toMatchObject({
      assetId: "flat-source",
      source: "extracted",
    });
  });
});
