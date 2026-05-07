import { describe, expect, it, vi } from "vitest";
import { createLayeredDesignFlatImageAnalyzerFromStructuredProvider } from "./analyzer";
import { createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider } from "./structuredAnalyzerWorkerHeuristic";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

describe("LayeredDesign worker heuristic structured analyzer", () => {
  it("应在 Worker provider 内产出 structured image/mask/clean plate 结果", async () => {
    const close = vi.fn();
    const rasterizerFactory = vi.fn(async () => ({
      cropImageToPngDataUrl: vi.fn(async (rect) => {
        return `data:image/png;base64,crop-${rect.x}-${rect.y}`;
      }),
      cropImageWithEllipseMaskToPngDataUrl: vi.fn(async (rect) => {
        return `data:image/png;base64,masked-${rect.x}-${rect.y}`;
      }),
      createEllipseMaskDataUrl: vi.fn(async (size) => {
        return `data:image/png;base64,mask-${size.width}-${size.height}`;
      }),
      createApproximateCleanPlateDataUrl: vi.fn(async (rect) => {
        return `data:image/png;base64,clean-${rect.width}-${rect.height}`;
      }),
      close,
    }));
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        rasterizerFactory,
      });

    const result = await provider.analyze({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });

    expect(rasterizerFactory).toHaveBeenCalledWith({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
    });
    expect(result).toMatchObject({
      analyzer: {
        kind: "local_heuristic",
        label: "Worker local heuristic analyzer",
      },
      providerCapabilities: [
        {
          kind: "clean_plate",
          label: "Local heuristic clean plate fallback",
          execution: "local_heuristic",
          quality: {
            productionReady: false,
            requiresHumanReview: true,
          },
        },
      ],
      generatedAt: CREATED_AT,
      cleanPlate: {
        asset: {
          kind: "clean_plate",
          src: expect.stringContaining("clean-"),
        },
      },
    });
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates[0]).toMatchObject({
      id: "subject-candidate",
      type: "image",
      role: "subject",
      image: {
        src: expect.stringContaining("masked-"),
        hasAlpha: true,
      },
      mask: {
        src: expect.stringContaining("mask-"),
      },
    });
    expect(result.candidates[2]).toMatchObject({
      id: "body-text-candidate",
      type: "image",
      role: "text",
      name: "正文/按钮文字候选",
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("应可通过 analyzer adapter 写回 current analysis outputs", async () => {
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        rasterizerFactory: vi.fn(async () => ({
          cropImageToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,crop";
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
        })),
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

    expect(result.analysis).toMatchObject({
      analyzer: {
        kind: "local_heuristic",
        label: "Worker local heuristic analyzer",
      },
      outputs: {
        candidateRaster: true,
        candidateMask: true,
        cleanPlate: true,
        ocrText: false,
      },
      providerCapabilities: [
        {
          kind: "clean_plate",
          label: "Local heuristic clean plate fallback",
          execution: "local_heuristic",
        },
      ],
    });
    expect(result.candidates[0]).toMatchObject({
      id: "subject-candidate",
      layer: {
        type: "image",
        assetId: "subject-asset",
        alphaMode: "mask",
      },
    });
    expect(result.cleanPlate.status).toBe("succeeded");
  });

  it("应优先使用 Worker refined subject mask seam", async () => {
    const cropImageWithEllipseMaskToPngDataUrl = vi.fn(async () => {
      return "data:image/png;base64,ellipse";
    });
    const createEllipseMaskDataUrl = vi.fn(async () => {
      return "data:image/png;base64,ellipse-mask";
    });
    const cropImageWithRefinedSubjectMaskToPngDataUrl = vi.fn(async (rect) => {
      return `data:image/png;base64,refined-${rect.width}-${rect.height}`;
    });
    const createRefinedSubjectMaskDataUrl = vi.fn(async (rect) => {
      return `data:image/png;base64,refined-mask-${rect.width}-${rect.height}`;
    });
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        rasterizerFactory: vi.fn(async () => ({
          cropImageToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,crop";
          }),
          cropImageWithRefinedSubjectMaskToPngDataUrl,
          cropImageWithEllipseMaskToPngDataUrl,
          createRefinedSubjectMaskDataUrl,
          createEllipseMaskDataUrl,
          createApproximateCleanPlateDataUrl: vi.fn(async () => {
            return "data:image/png;base64,clean";
          }),
        })),
      });

    const result = await provider.analyze({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });

    expect(cropImageWithRefinedSubjectMaskToPngDataUrl).toHaveBeenCalledTimes(
      1,
    );
    expect(createRefinedSubjectMaskDataUrl).toHaveBeenCalledTimes(1);
    expect(cropImageWithEllipseMaskToPngDataUrl).not.toHaveBeenCalled();
    expect(createEllipseMaskDataUrl).not.toHaveBeenCalled();
    expect(result.candidates[0]).toMatchObject({
      image: {
        src: expect.stringContaining("refined-"),
        params: {
          seed: "worker_heuristic_subject_refined_masked",
        },
      },
      mask: {
        src: expect.stringContaining("refined-mask-"),
        params: {
          seed: "worker_heuristic_subject_refined_mask",
        },
      },
    });
  });

  it("应优先使用 Worker subject mask refiner seam 输出主体 matting 候选", async () => {
    const cropImageToPngDataUrl = vi.fn(async (rect) => {
      return `data:image/png;base64,raw-subject-${rect.x}-${rect.y}`;
    });
    const cropImageWithRefinedSubjectMaskToPngDataUrl = vi.fn(async () => {
      return "data:image/png;base64,refined-fallback";
    });
    const createRefinedSubjectMaskDataUrl = vi.fn(async () => {
      return "data:image/png;base64,refined-mask-fallback";
    });
    const subjectMaskRefiner = vi.fn(async (input) => ({
      imageSrc: `data:image/png;base64,matted-${input.candidate.rect.width}`,
      maskSrc: "data:image/png;base64,matted-mask",
      confidence: 0.89,
      hasAlpha: true,
    }));
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        subjectMaskRefiner,
        rasterizerFactory: vi.fn(async () => ({
          cropImageToPngDataUrl,
          cropImageWithRefinedSubjectMaskToPngDataUrl,
          cropImageWithEllipseMaskToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,ellipse";
          }),
          createRefinedSubjectMaskDataUrl,
          createEllipseMaskDataUrl: vi.fn(async () => {
            return "data:image/png;base64,ellipse-mask";
          }),
          createApproximateCleanPlateDataUrl: vi.fn(async () => {
            return "data:image/png;base64,clean";
          }),
        })),
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

    expect(subjectMaskRefiner).toHaveBeenCalledTimes(1);
    expect(subjectMaskRefiner).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: "subject-candidate",
          name: "主体候选",
          crop: expect.objectContaining({
            src: expect.stringContaining("raw-subject-"),
            mimeType: "image/png",
          }),
        }),
      }),
    );
    expect(cropImageWithRefinedSubjectMaskToPngDataUrl).not.toHaveBeenCalled();
    expect(createRefinedSubjectMaskDataUrl).not.toHaveBeenCalled();
    expect(result.analysis.outputs).toMatchObject({
      candidateRaster: true,
      candidateMask: true,
      cleanPlate: true,
    });
    expect(result.candidates[0]).toMatchObject({
      confidence: 0.89,
      layer: {
        type: "image",
        alphaMode: "mask",
        maskAssetId: "subject-mask",
      },
      assets: [
        expect.objectContaining({
          id: "subject-asset",
          kind: "subject",
          src: expect.stringContaining("matted-"),
          hasAlpha: true,
          params: {
            seed: "worker_heuristic_subject_matted",
            inputMimeType: "image/png",
            outputMimeType: "image/png",
            sourceRect: expect.any(Object),
          },
        }),
        expect.objectContaining({
          id: "subject-mask",
          kind: "mask",
          src: "data:image/png;base64,matted-mask",
          params: {
            seed: "worker_heuristic_subject_matte_mask",
          },
        }),
      ],
    });
  });

  it("应优先使用 Worker refined clean plate seam", async () => {
    const createRefinedCleanPlateDataUrl = vi.fn(async (rect) => {
      return `data:image/png;base64,refined-clean-${rect.x}-${rect.y}`;
    });
    const createApproximateCleanPlateDataUrl = vi.fn(async () => {
      return "data:image/png;base64,approximate-clean";
    });
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        rasterizerFactory: vi.fn(async () => ({
          cropImageToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,crop";
          }),
          cropImageWithEllipseMaskToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,masked";
          }),
          createEllipseMaskDataUrl: vi.fn(async () => {
            return "data:image/png;base64,mask";
          }),
          createRefinedCleanPlateDataUrl,
          createApproximateCleanPlateDataUrl,
        })),
      });

    const result = await provider.analyze({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
    });

    expect(createRefinedCleanPlateDataUrl).toHaveBeenCalledTimes(1);
    expect(createApproximateCleanPlateDataUrl).not.toHaveBeenCalled();
    expect(result.cleanPlate).toMatchObject({
      asset: {
        src: expect.stringContaining("refined-clean-"),
        params: {
          seed: "worker_heuristic_refined_clean_plate",
        },
      },
      message: expect.stringContaining("不是真 inpaint"),
    });
  });

  it("应可通过 Worker text candidate extractor seam 输出 TextLayer 候选", async () => {
    const textCandidateExtractor = vi.fn(async () => ({
      text: "SPRING DROP",
      fontSize: 42,
      color: "#111111",
      align: "center" as const,
      lineHeight: 1.1,
    }));
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        textCandidateExtractor,
        rasterizerFactory: vi.fn(async () => ({
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
        })),
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

    expect(textCandidateExtractor).toHaveBeenCalledTimes(2);
    expect(textCandidateExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: "headline-candidate",
          name: "标题文字候选",
          crop: expect.objectContaining({
            src: expect.stringContaining("crop-"),
            mimeType: "image/png",
          }),
        }),
      }),
    );
    expect(textCandidateExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: "body-text-candidate",
          name: "正文/按钮文字候选",
          crop: expect.objectContaining({
            src: expect.stringContaining("crop-"),
            mimeType: "image/png",
          }),
        }),
      }),
    );
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
      layer: {
        type: "text",
        text: "SPRING DROP",
        fontSize: 42,
        color: "#111111",
        lineHeight: 1.1,
      },
    });
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "body-text-candidate",
      ),
    ).toMatchObject({
      layer: {
        type: "text",
        text: "SPRING DROP",
        fontSize: 42,
      },
    });
  });

  it("应可通过 Worker logo candidate refiner seam 输出带 mask 的 Logo 候选", async () => {
    const logoCandidateRefiner = vi.fn(async (input) => ({
      imageSrc: `data:image/png;base64,refined-logo-${input.candidate.rect.width}`,
      maskSrc: "data:image/png;base64,refined-logo-mask",
      confidence: 0.81,
      hasAlpha: true,
    }));
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        logoCandidateRefiner,
        rasterizerFactory: vi.fn(async () => ({
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
        })),
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

    expect(logoCandidateRefiner).toHaveBeenCalledTimes(1);
    expect(logoCandidateRefiner).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: "logo-candidate",
          name: "Logo 候选",
          crop: expect.objectContaining({
            src: expect.stringContaining("crop-"),
            mimeType: "image/png",
          }),
        }),
      }),
    );
    expect(result.analysis.outputs).toMatchObject({
      candidateRaster: true,
      candidateMask: true,
      cleanPlate: true,
    });
    expect(
      result.candidates.find((candidate) => candidate.id === "logo-candidate"),
    ).toMatchObject({
      confidence: 0.81,
      layer: {
        type: "image",
        alphaMode: "mask",
        maskAssetId: "logo-mask",
      },
      assets: [
        expect.objectContaining({
          id: "logo-asset",
          kind: "logo",
          src: expect.stringContaining("refined-logo-"),
          params: {
            seed: "worker_heuristic_logo_refined",
            inputMimeType: "image/png",
            outputMimeType: "image/png",
            sourceRect: expect.any(Object),
          },
        }),
        expect.objectContaining({
          id: "logo-mask",
          kind: "mask",
          src: "data:image/png;base64,refined-logo-mask",
          params: {
            seed: "worker_heuristic_logo_refined_mask",
          },
        }),
      ],
    });
  });

  it("应可通过 Worker background fragment refiner seam 输出带 mask 的背景碎片候选", async () => {
    const backgroundFragmentRefiner = vi.fn(async (input) => ({
      imageSrc: `data:image/png;base64,refined-fragment-${input.candidate.rect.height}`,
      maskSrc: "data:image/png;base64,refined-fragment-mask",
      confidence: 0.67,
      hasAlpha: true,
    }));
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        backgroundFragmentRefiner,
        rasterizerFactory: vi.fn(async () => ({
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
        })),
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

    expect(backgroundFragmentRefiner).toHaveBeenCalledTimes(1);
    expect(backgroundFragmentRefiner).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: "fragment-candidate",
          name: "边角碎片",
          crop: expect.objectContaining({
            src: expect.stringContaining("crop-"),
            mimeType: "image/png",
          }),
        }),
      }),
    );
    expect(result.analysis.outputs).toMatchObject({
      candidateRaster: true,
      candidateMask: true,
      cleanPlate: true,
    });
    expect(
      result.candidates.find(
        (candidate) => candidate.id === "fragment-candidate",
      ),
    ).toMatchObject({
      confidence: 0.67,
      layer: {
        type: "image",
        alphaMode: "mask",
        maskAssetId: "fragment-mask",
      },
      assets: [
        expect.objectContaining({
          id: "fragment-asset",
          kind: "effect",
          src: expect.stringContaining("refined-fragment-"),
          params: {
            seed: "worker_heuristic_background_fragment_refined",
            inputMimeType: "image/png",
            outputMimeType: "image/png",
            sourceRect: expect.any(Object),
          },
        }),
        expect.objectContaining({
          id: "fragment-mask",
          kind: "mask",
          src: "data:image/png;base64,refined-fragment-mask",
          params: {
            seed: "worker_heuristic_background_fragment_refined_mask",
          },
        }),
      ],
    });
  });
});
