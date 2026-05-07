import { afterEach, describe, expect, it, vi } from "vitest";
import { createLayeredDesignFlatImageDraftDocument } from "./flatImage";
import { createLayeredDesignFlatImageHeuristicSeed } from "./flatImageHeuristics";

const CREATED_AT = "2026-05-06T02:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LayeredDesign flat image draft", () => {
  it("应从上传扁平图创建最小 draft，并把原图接到 extraction 背景层", () => {
    const document = createLayeredDesignFlatImageDraftDocument({
      image: {
        src: "data:image/png;base64,flat",
        width: 1024,
        height: 1536,
        fileName: "campaign-poster.png",
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });

    expect(document.id).toBe("campaign-poster");
    expect(document.title).toBe("campaign-poster");
    expect(document.canvas).toEqual({
      width: 1024,
      height: 1536,
    });
    expect(document.assets[0]).toMatchObject({
      id: "campaign-poster-source-image",
      kind: "source_image",
      src: "data:image/png;base64,flat",
      params: {
        mimeType: "image/png",
      },
    });
    expect(document.layers.map((layer) => layer.id)).toEqual([
      "extraction-background-image",
    ]);
    expect(document.extraction).toMatchObject({
      sourceAssetId: "campaign-poster-source-image",
      cleanPlate: {
        status: "not_requested",
      },
      candidates: [],
    });
  });

  it("应允许 flat image draft 直接承接本地拆层 seed，并自动只 materialize 高置信度候选", () => {
    const document = createLayeredDesignFlatImageDraftDocument({
      title: "夏日促销海报",
      image: {
        src: "https://example.com/sale.jpg",
        width: 1200,
        height: 1600,
      },
      candidates: [
        {
          id: "subject-candidate",
          role: "subject",
          confidence: 0.88,
          layer: {
            id: "subject-layer",
            name: "主商品",
            type: "image",
            assetId: "subject-asset",
            x: 180,
            y: 240,
            width: 840,
            height: 960,
            zIndex: 20,
            alphaMode: "embedded",
          },
          assets: [
            {
              id: "subject-asset",
              kind: "subject",
              src: "data:image/png;base64,subject",
              width: 840,
              height: 960,
              hasAlpha: true,
              createdAt: CREATED_AT,
            },
          ],
        },
        {
          id: "fragment-candidate",
          role: "background_fragment",
          confidence: 0.18,
          layer: {
            id: "fragment-layer",
            name: "边角碎片",
            type: "image",
            assetId: "fragment-asset",
            x: 24,
            y: 32,
            width: 90,
            height: 90,
            zIndex: 30,
            alphaMode: "embedded",
          },
          assets: [
            {
              id: "fragment-asset",
              kind: "effect",
              src: "data:image/png;base64,fragment",
              width: 90,
              height: 90,
              hasAlpha: true,
              createdAt: CREATED_AT,
            },
          ],
        },
      ],
      createdAt: CREATED_AT,
    });

    expect(document.layers.map((layer) => layer.id)).toEqual([
      "extraction-background-image",
      "subject-layer",
    ]);
    expect(
      document.extraction?.candidates.find(
        (candidate) => candidate.id === "fragment-candidate",
      ),
    ).toMatchObject({
      selected: false,
      issues: ["low_confidence"],
    });
  });

  it("应通过本地 heuristic seed 生成真实裁片候选，并只默认 materialize 高置信度候选", async () => {
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 900;
        naturalHeight = 1400;
        width = 900;
        height = 1400;

        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );

    const originalCreateElement = document.createElement.bind(document);
    let cropIndex = 0;
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string) => {
        const element = originalCreateElement(tagName);

        if (tagName.toLowerCase() === "canvas") {
          Object.defineProperty(element, "getContext", {
            configurable: true,
            value: () => ({ drawImage: vi.fn() }),
          });
          Object.defineProperty(element, "toDataURL", {
            configurable: true,
            value: () => `data:image/png;base64,aGV1cmlzdGljLWNyb3At${++cropIndex}`,
          });
        }

        return element;
      }) as typeof document.createElement,
    );

    const seed = await createLayeredDesignFlatImageHeuristicSeed({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });
    const draftDocument = createLayeredDesignFlatImageDraftDocument({
      title: "heuristic-flat",
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        fileName: "heuristic-flat.png",
        mimeType: "image/png",
      },
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
        generatedAt: CREATED_AT,
      },
      candidates: seed.candidates,
      cleanPlate: seed.cleanPlate,
      createdAt: CREATED_AT,
    });

    expect(seed.candidates.map((candidate) => candidate.id)).toEqual([
      "subject-candidate",
      "headline-candidate",
      "body-text-candidate",
      "logo-candidate",
      "fragment-candidate",
    ]);
    expect(draftDocument.layers.map((layer) => layer.id)).toEqual([
      "extraction-background-image",
      "subject-layer",
      "headline-layer",
      "body-text-layer",
    ]);
    expect(draftDocument.extraction?.cleanPlate).toMatchObject({
      status: "not_requested",
      message: "当前候选来自本地 heuristic 裁片；尚未执行 clean plate。",
    });
    expect(draftDocument.extraction?.analysis).toMatchObject({
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
    });
    expect(
      draftDocument.extraction?.candidates.find(
        (candidate) => candidate.id === "subject-candidate",
      ),
    ).toMatchObject({
      selected: true,
      layer: {
        name: "主体候选",
      },
    });
    expect(
      draftDocument.extraction?.candidates.find(
        (candidate) => candidate.id === "headline-candidate",
      ),
    ).toMatchObject({
      selected: true,
      layer: {
        name: "标题文字候选",
      },
    });
    expect(
      draftDocument.extraction?.candidates.find(
        (candidate) => candidate.id === "body-text-candidate",
      ),
    ).toMatchObject({
      selected: true,
      layer: {
        name: "正文/按钮文字候选",
      },
    });
    expect(
      draftDocument.extraction?.candidates.find(
        (candidate) => candidate.id === "logo-candidate",
      ),
    ).toMatchObject({
      selected: false,
      issues: ["low_confidence"],
    });
    expect(
      draftDocument.assets.find((asset) => asset.id === "subject-asset"),
    ).toMatchObject({
      kind: "subject",
      src: "data:image/png;base64,aGV1cmlzdGljLWNyb3At1",
    });
  });
});
