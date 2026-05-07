import { describe, expect, it, vi } from "vitest";
import {
  createLayeredDesignFlatImageAnalyzerFromStructuredProvider,
  type LayeredDesignFlatImageTextOcrProviderInput,
} from "./analyzer";
import { createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider } from "./structuredAnalyzerWorkerHeuristic";
import {
  createLayeredDesignDeterministicTextOcrProvider,
  createLayeredDesignPrioritizedTextOcrProvider,
  detectTextWithLayeredDesignPrioritizedTextOcrProviders,
  createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider,
} from "./textOcr";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

const textExtractorInput = {
  image: {
    src: "data:image/png;base64,flat",
    width: 900,
    height: 1400,
    mimeType: "image/png",
  },
  createdAt: CREATED_AT,
  candidate: {
    id: "headline-candidate",
    name: "标题文字候选",
    rect: {
      x: 108,
      y: 84,
      width: 684,
      height: 252,
    },
    confidence: 0.62,
    zIndex: 40,
    crop: {
      src: "data:image/png;base64,headline-crop",
      width: 684,
      height: 252,
      mimeType: "image/png" as const,
    },
  },
};

const ocrProviderInput: LayeredDesignFlatImageTextOcrProviderInput = {
  image: textExtractorInput.image,
  candidate: {
    id: "headline-candidate",
    name: "标题文字候选",
    role: "text",
    rect: textExtractorInput.candidate.rect,
    asset: {
      id: "headline-asset",
      kind: "text_raster",
      src: "data:image/png;base64,headline-crop",
      width: 684,
      height: 252,
      hasAlpha: true,
      createdAt: CREATED_AT,
    },
  },
};

function createRasterizerFactory() {
  return vi.fn(async () => ({
    cropImageToPngDataUrl: vi.fn(async (rect) => {
      return `data:image/png;base64,crop-${rect.x}-${rect.y}`;
    }),
    cropImageWithEllipseMaskToPngDataUrl: vi.fn(async () => {
      return "data:image/png;base64,masked";
    }),
    createEllipseMaskDataUrl: vi.fn(async () => {
      return "data:image/png;base64,mask";
    }),
    createApproximateCleanPlateDataUrl: vi.fn(async () => {
      return "data:image/png;base64,clean";
    }),
  }));
}

describe("LayeredDesign text OCR adapter", () => {
  it("应把 OCR provider 结果包装成 Worker text candidate extractor", async () => {
    const detectText = vi.fn(async () => [
      {
        text: "SPRING",
        boundingBox: { x: 10, y: 20, width: 300, height: 40 },
        confidence: 0.88,
      },
      {
        text: "DROP",
        boundingBox: { x: 20, y: 80, width: 500, height: 50 },
        confidence: 0.91,
      },
    ]);
    const extractor =
      createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider({
        label: "Worker OCR fixture",
        detectText,
      });

    await expect(extractor(textExtractorInput)).resolves.toEqual([
      {
        text: "SPRING",
        rect: {
          x: 118,
          y: 104,
          width: 300,
          height: 40,
        },
        confidence: 0.88,
        fontSize: 32,
        color: "#111111",
        align: "center",
        lineHeight: 1.1,
      },
      {
        text: "DROP",
        rect: {
          x: 128,
          y: 164,
          width: 500,
          height: 50,
        },
        confidence: 0.91,
        fontSize: 40,
        color: "#111111",
        align: "center",
        lineHeight: 1.1,
      },
    ]);
    expect(detectText).toHaveBeenCalledWith({
      image: textExtractorInput.image,
      candidate: {
        id: "headline-candidate",
        name: "标题文字候选",
        role: "text",
        rect: textExtractorInput.candidate.rect,
        asset: expect.objectContaining({
          id: "headline-candidate-ocr-crop",
          kind: "text_raster",
          src: "data:image/png;base64,headline-crop",
          width: 684,
          height: 252,
          provider: "Worker OCR fixture",
        }),
      },
    });
  });

  it("OCR provider 无结果或失败时应返回 null 交给 worker fallback", async () => {
    const emptyExtractor =
      createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider({
        label: "Empty OCR",
        detectText: vi.fn(async () => [{ text: "  " }]),
      });
    await expect(emptyExtractor(textExtractorInput)).resolves.toBeNull();

    const failedExtractor =
      createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider({
        label: "Failed OCR",
        detectText: vi.fn(async () => {
          throw new Error("OCR 暂不可用");
        }),
      });
    await expect(failedExtractor(textExtractorInput)).resolves.toBeNull();
  });

  it("deterministic OCR provider 应输出可预测文本块", async () => {
    const provider = createLayeredDesignDeterministicTextOcrProvider({
      label: "Deterministic OCR fixture",
      text: "WORKER REFINED TEXT",
      confidence: 0.92,
      boundingBox: { x: 8, y: 12, width: 320, height: 56 },
    });

    await expect(
      provider.detectText({
        image: textExtractorInput.image,
        candidate: {
          id: "headline-candidate",
          name: "标题文字候选",
          role: "text",
          rect: textExtractorInput.candidate.rect,
          asset: {
            id: "headline-asset",
            kind: "text_raster",
            src: "data:image/png;base64,headline-crop",
            width: 684,
            height: 252,
            hasAlpha: true,
            createdAt: CREATED_AT,
          },
        },
      }),
    ).resolves.toEqual([
      {
        text: "WORKER REFINED TEXT",
        boundingBox: { x: 8, y: 12, width: 320, height: 56 },
        confidence: 0.92,
      },
    ]);
  });

  it("priority OCR provider 应跳过失败和空文本来源", async () => {
    const failedProvider = {
      label: "失败 OCR",
      detectText: vi.fn(async () => {
        throw new Error("OCR 暂不可用");
      }),
    };
    const emptyProvider = {
      label: "空 OCR",
      detectText: vi.fn(async () => [{ text: "  " }]),
    };
    const winnerProvider = {
      label: "可用 OCR",
      detectText: vi.fn(async () => [
        {
          text: "优先级标题",
          boundingBox: { x: 6, y: 8, width: 240, height: 64 },
          confidence: 0.87,
        },
      ]),
    };
    const fallbackProvider = {
      label: "备用 OCR",
      detectText: vi.fn(async () => [{ text: "不应调用" }]),
    };
    const provider = createLayeredDesignPrioritizedTextOcrProvider([
      failedProvider,
      null,
      emptyProvider,
      winnerProvider,
      fallbackProvider,
    ]);

    expect(provider.label).toBe("OCR priority: 失败 OCR -> 空 OCR -> 可用 OCR -> 备用 OCR");
    await expect(provider.detectText(ocrProviderInput)).resolves.toEqual([
      {
        text: "优先级标题",
        boundingBox: { x: 6, y: 8, width: 240, height: 64 },
        confidence: 0.87,
      },
    ]);
    expect(failedProvider.detectText).toHaveBeenCalledTimes(1);
    expect(emptyProvider.detectText).toHaveBeenCalledTimes(1);
    expect(winnerProvider.detectText).toHaveBeenCalledTimes(1);
    expect(fallbackProvider.detectText).not.toHaveBeenCalled();
  });

  it("priority OCR detector 应返回命中的 provider 以保留来源标签", async () => {
    const browserProvider = {
      label: "浏览器 OCR",
      detectText: vi.fn(async () => [
        {
          text: "浏览器标题",
          boundingBox: { x: 8, y: 10, width: 260, height: 72 },
        },
      ]),
    };

    await expect(
      detectTextWithLayeredDesignPrioritizedTextOcrProviders(
        [
          {
            label: "空 native OCR",
            detectText: vi.fn(async () => []),
          },
          browserProvider,
        ],
        ocrProviderInput,
      ),
    ).resolves.toMatchObject({
      provider: {
        label: "浏览器 OCR",
      },
      blocks: [
        {
          text: "浏览器标题",
        },
      ],
    });
    expect(browserProvider.detectText).toHaveBeenCalledTimes(1);
  });

  it("priority OCR provider 全部失败或无文本时应返回空数组", async () => {
    const provider = createLayeredDesignPrioritizedTextOcrProvider(
      [
        {
          label: "失败 OCR",
          detectText: vi.fn(async () => {
            throw new Error("OCR 暂不可用");
          }),
        },
        {
          label: "空 OCR",
          detectText: vi.fn(async () => [{ text: "" }]),
        },
      ],
      { label: "测试 OCR priority" },
    );

    expect(provider.label).toBe("测试 OCR priority");
    await expect(provider.detectText(ocrProviderInput)).resolves.toEqual([]);
  });

  it("应通过 Worker heuristic analyzer 写回 current TextLayer extraction", async () => {
    const extractor =
      createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider(
        createLayeredDesignDeterministicTextOcrProvider({
          text: "WORKER OCR TEXT",
          confidence: 0.93,
        }),
      );
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        textCandidateExtractor: extractor,
        rasterizerFactory: createRasterizerFactory(),
      });
    const analyzer = createLayeredDesignFlatImageAnalyzerFromStructuredProvider(
      provider,
      {
        fallbackAnalyzer: null,
      },
    );

    const result = await analyzer({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });

    expect(result.analysis.outputs).toMatchObject({
      candidateRaster: true,
      cleanPlate: true,
      ocrText: true,
    });
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "headline-candidate",
      ),
    ).toMatchObject({
      confidence: 0.93,
      layer: {
        type: "text",
        text: "WORKER OCR TEXT",
        color: "#111111",
        align: "center",
      },
    });
  });

  it("Worker OCR adapter 多块文本应写回多个独立 TextLayer", async () => {
    const detectText = vi.fn(
      async (input: LayeredDesignFlatImageTextOcrProviderInput) => {
        if (input.candidate.id !== "headline-candidate") {
          return [];
        }

        return [
          {
            text: "主标题",
            boundingBox: { x: 10, y: 20, width: 300, height: 40 },
            confidence: 0.88,
            params: {
              modelSlotExecution: {
                slotId: "worker-ocr",
                attempt: 1,
              },
            },
          },
          {
            text: "按钮文案",
            boundingBox: { x: 20, y: 80, width: 160, height: 44 },
            confidence: 0.91,
          },
        ];
      },
    );
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        textCandidateExtractor:
          createLayeredDesignWorkerTextCandidateExtractorFromOcrProvider({
            label: "Worker OCR multi-block",
            detectText,
          }),
        rasterizerFactory: createRasterizerFactory(),
      });
    const analyzer = createLayeredDesignFlatImageAnalyzerFromStructuredProvider(
      provider,
      {
        fallbackAnalyzer: null,
      },
    );

    const result = await analyzer({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });

    expect(
      result.candidates.find(
        (candidate) => candidate.id === "headline-candidate",
      ),
    ).toBeUndefined();
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "headline-candidate-text-1",
      ),
    ).toMatchObject({
      confidence: 0.88,
      layer: {
        type: "text",
        name: "标题文字候选 1",
        text: "主标题",
        x: 118,
        y: 104,
        width: 300,
        height: 40,
        zIndex: 40,
        fontSize: 32,
        params: {
          modelSlotExecution: {
            slotId: "worker-ocr",
            attempt: 1,
          },
          ocrSourceCandidateId: "headline-candidate",
          ocrBlockIndex: 0,
          ocrBlockCount: 2,
        },
      },
    });
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "headline-candidate-text-2",
      ),
    ).toMatchObject({
      confidence: 0.91,
      layer: {
        type: "text",
        name: "标题文字候选 2",
        text: "按钮文案",
        x: 128,
        y: 164,
        width: 160,
        height: 44,
        zIndex: 41,
        fontSize: 35,
        params: {
          ocrSourceCandidateId: "headline-candidate",
          ocrBlockIndex: 1,
          ocrBlockCount: 2,
        },
      },
    });
  });
});
