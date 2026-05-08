import { describe, expect, it, vi } from "vitest";
import { createLayeredDesignFlatImageAnalyzerFromStructuredProvider } from "./analyzer";
import { createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider } from "./structuredAnalyzerWorkerHeuristic";
import {
  applyLayeredDesignSimpleSubjectMattingToRgba,
  createLayeredDesignDeterministicSubjectMattingProvider,
  createLayeredDesignSimpleSubjectMattingProvider,
  createLayeredDesignSubjectMaskRefinerFromMattingProvider,
  type LayeredDesignSubjectMattingPixelImage,
} from "./subjectMatting";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

function createSyntheticSubjectCrop(): LayeredDesignSubjectMattingPixelImage {
  const width = 5;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isSubject = x >= 1 && x <= 3 && y >= 1 && y <= 3;
      data[offset] = isSubject ? 28 : 232;
      data[offset + 1] = isSubject ? 76 : 236;
      data[offset + 2] = isSubject ? 136 : 232;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

function createSyntheticSubjectCropWithSpeckle(): LayeredDesignSubjectMattingPixelImage {
  const width = 7;
  const height = 7;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isSubject = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      const isSpeckle = x === 1 && y === 1;
      data[offset] = isSubject || isSpeckle ? 28 : 232;
      data[offset + 1] = isSubject || isSpeckle ? 76 : 236;
      data[offset + 2] = isSubject || isSpeckle ? 136 : 232;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

function createSyntheticSubjectCropWithDetachedPatch(): LayeredDesignSubjectMattingPixelImage {
  const width = 9;
  const height = 9;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isSubject = x >= 3 && x <= 5 && y >= 3 && y <= 5;
      const isDetachedPatch = x >= 1 && x <= 2 && y >= 1 && y <= 2;
      data[offset] = isSubject || isDetachedPatch ? 28 : 232;
      data[offset + 1] = isSubject || isDetachedPatch ? 76 : 236;
      data[offset + 2] = isSubject || isDetachedPatch ? 136 : 232;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

function createSyntheticSubjectCropWithInteriorHole(): LayeredDesignSubjectMattingPixelImage {
  const width = 11;
  const height = 11;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isSubject = x >= 2 && x <= 8 && y >= 2 && y <= 8;
      const isInteriorHole = x >= 4 && x <= 6 && y >= 4 && y <= 6;
      data[offset] = isSubject && !isInteriorHole ? 28 : 232;
      data[offset + 1] = isSubject && !isInteriorHole ? 76 : 236;
      data[offset + 2] = isSubject && !isInteriorHole ? 136 : 232;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

function createSyntheticSubjectCropWithSpillEdge(): LayeredDesignSubjectMattingPixelImage {
  const width = 7;
  const height = 7;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isSubjectCore = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      const isSpillEdge = x >= 1 && x <= 5 && y >= 1 && y <= 5;
      data[offset] = isSubjectCore ? 28 : isSpillEdge ? 188 : 232;
      data[offset + 1] = isSubjectCore ? 76 : isSpillEdge ? 204 : 236;
      data[offset + 2] = isSubjectCore ? 136 : isSpillEdge ? 216 : 232;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

function createSyntheticFlatBackgroundCrop(): LayeredDesignSubjectMattingPixelImage {
  const width = 9;
  const height = 9;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 232;
      data[offset + 1] = 236;
      data[offset + 2] = 232;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

function rgbDistance(
  left: ReadonlyArray<number | undefined>,
  right: ReadonlyArray<number | undefined>,
): number {
  return Math.hypot(
    (left[0] ?? 0) - (right[0] ?? 0),
    (left[1] ?? 0) - (right[1] ?? 0),
    (left[2] ?? 0) - (right[2] ?? 0),
  );
}

describe("LayeredDesign subject matting adapter", () => {
  it("应把 matting provider 包装成 Worker subjectMaskRefiner 并写回 current extraction", async () => {
    const matteSubject = vi.fn(async (input) => ({
      imageSrc: `data:image/png;base64,matte-${input.subject.rect.width}`,
      maskSrc: "data:image/png;base64,matte-mask",
      confidence: 0.94,
      hasAlpha: true,
    }));
    const subjectMaskRefiner =
      createLayeredDesignSubjectMaskRefinerFromMattingProvider({
        label: "Fixture subject matting worker",
        matteSubject,
      });
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        subjectMaskRefiner,
        rasterizerFactory: vi.fn(async () => ({
          cropImageToPngDataUrl: vi.fn(async (rect) => {
            return `data:image/png;base64,crop-${rect.x}-${rect.y}`;
          }),
          cropImageWithRefinedSubjectMaskToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,refined";
          }),
          cropImageWithEllipseMaskToPngDataUrl: vi.fn(async () => {
            return "data:image/png;base64,ellipse";
          }),
          createRefinedSubjectMaskDataUrl: vi.fn(async () => {
            return "data:image/png;base64,refined-mask";
          }),
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

    expect(matteSubject).toHaveBeenCalledWith({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
      subject: expect.objectContaining({
        id: "subject-candidate",
        name: "主体候选",
        crop: expect.objectContaining({
          src: expect.stringContaining("crop-"),
          mimeType: "image/png",
        }),
      }),
    });
    expect(result.analysis.outputs).toMatchObject({
      candidateRaster: true,
      candidateMask: true,
      cleanPlate: true,
    });
    expect(result.candidates[0]).toMatchObject({
      confidence: 0.94,
      layer: {
        type: "image",
        alphaMode: "mask",
        maskAssetId: "subject-mask",
      },
      assets: [
        expect.objectContaining({
          id: "subject-asset",
          kind: "subject",
          src: expect.stringContaining("matte-"),
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
          src: "data:image/png;base64,matte-mask",
          params: {
            seed: "worker_heuristic_subject_matte_mask",
          },
        }),
      ],
    });
  });

  it("matting provider 无效或失败时应返回 null 交回 Worker fallback", async () => {
    const invalidRefiner =
      createLayeredDesignSubjectMaskRefinerFromMattingProvider({
        label: "Invalid subject matting worker",
        matteSubject: vi.fn(async () => ({
          imageSrc: " ",
          maskSrc: "data:image/png;base64,mask",
        })),
      });
    const throwingRefiner =
      createLayeredDesignSubjectMaskRefinerFromMattingProvider({
        label: "Throwing subject matting worker",
        matteSubject: vi.fn(async () => {
          throw new Error("matting worker unavailable");
        }),
      });
    const input = {
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
      candidate: {
        id: "subject-candidate",
        name: "主体候选",
        rect: {
          x: 144,
          y: 224,
          width: 612,
          height: 980,
        },
        confidence: 0.74,
        zIndex: 20,
        crop: {
          src: "data:image/png;base64,crop",
          width: 612,
          height: 980,
          mimeType: "image/png" as const,
        },
      },
    };

    await expect(invalidRefiner(input)).resolves.toBeNull();
    await expect(throwingRefiner(input)).resolves.toBeNull();
  });

  it("deterministic matting provider 应以主体 crop 和不透明 mask 作为本地占位执行源", async () => {
    const provider = createLayeredDesignDeterministicSubjectMattingProvider({
      confidence: 0.87,
    });

    const result = await provider.matteSubject({
      image: {
        src: "data:image/png;base64,flat",
        width: 900,
        height: 1400,
        mimeType: "image/png",
      },
      createdAt: CREATED_AT,
      subject: {
        id: "subject-candidate",
        name: "主体候选",
        rect: {
          x: 144,
          y: 224,
          width: 612,
          height: 980,
        },
        confidence: 0.74,
        zIndex: 20,
        crop: {
          src: "data:image/png;base64,subject-crop",
          width: 612,
          height: 980,
          mimeType: "image/png",
        },
      },
    });

    expect(result).toMatchObject({
      imageSrc: "data:image/png;base64,subject-crop",
      maskSrc: expect.stringMatching(/^data:image\/png;base64,/),
      rect: {
        x: 144,
        y: 224,
        width: 612,
        height: 980,
      },
      confidence: 0.87,
      hasAlpha: true,
    });
  });

  it("simple matting 算法应基于边缘背景差异生成主体 alpha 和 mask", () => {
    const result = applyLayeredDesignSimpleSubjectMattingToRgba(
      createSyntheticSubjectCrop(),
    );
    const centerOffset = (2 * result.image.width + 2) * 4;
    const cornerOffset = 0;

    expect(result.image.data[centerOffset + 3]).toBeGreaterThan(220);
    expect(result.image.data[cornerOffset + 3]).toBeLessThan(16);
    expect(result.mask.data[centerOffset]).toBe(result.image.data[centerOffset + 3]);
    expect(result.mask.data[cornerOffset]).toBe(result.image.data[cornerOffset + 3]);
    expect(result.foregroundPixelCount).toBeGreaterThan(0);
  });

  it("simple matting 算法应清理孤立噪点并保留主体连通区域", () => {
    const result = applyLayeredDesignSimpleSubjectMattingToRgba(
      createSyntheticSubjectCropWithSpeckle(),
    );
    const centerOffset = (3 * result.image.width + 3) * 4;
    const speckleOffset = (1 * result.image.width + 1) * 4;

    expect(result.image.data[centerOffset + 3]).toBeGreaterThan(180);
    expect(result.image.data[speckleOffset + 3]).toBeLessThan(24);
    expect(result.mask.data[speckleOffset]).toBe(
      result.image.data[speckleOffset + 3],
    );
  });

  it("simple matting 算法应移除远离主体的小型误检连通块", () => {
    const result = applyLayeredDesignSimpleSubjectMattingToRgba(
      createSyntheticSubjectCropWithDetachedPatch(),
    );
    const centerOffset = (4 * result.image.width + 4) * 4;
    const detachedPatchOffset = (1 * result.image.width + 1) * 4;

    expect(result.image.data[centerOffset + 3]).toBeGreaterThan(180);
    expect(result.image.data[detachedPatchOffset + 3]).toBeLessThan(24);
    expect(result.mask.data[detachedPatchOffset]).toBe(
      result.image.data[detachedPatchOffset + 3],
    );
  });

  it("simple matting 算法应填补主体内部透明孔洞", () => {
    const result = applyLayeredDesignSimpleSubjectMattingToRgba(
      createSyntheticSubjectCropWithInteriorHole(),
    );
    const centerHoleOffset = (5 * result.image.width + 5) * 4;
    const cornerBackgroundOffset = 0;

    expect(result.filledHolePixelCount).toBeGreaterThanOrEqual(5);
    expect(result.image.data[centerHoleOffset + 3]).toBeGreaterThan(160);
    expect(result.mask.data[centerHoleOffset]).toBe(
      result.image.data[centerHoleOffset + 3],
    );
    expect(result.image.data[cornerBackgroundOffset + 3]).toBeLessThan(16);
  });

  it("simple matting 算法应压低半透明边缘的背景色污染", () => {
    const source = createSyntheticSubjectCropWithSpillEdge();
    const result = applyLayeredDesignSimpleSubjectMattingToRgba(source);
    const spillOffset = (1 * result.image.width + 3) * 4;
    const background = [232, 236, 232];
    const sourceColor = [
      source.data[spillOffset],
      source.data[spillOffset + 1],
      source.data[spillOffset + 2],
    ];
    const mattedColor = [
      result.image.data[spillOffset],
      result.image.data[spillOffset + 1],
      result.image.data[spillOffset + 2],
    ];

    expect(result.image.data[spillOffset + 3]).toBeGreaterThan(32);
    expect(result.image.data[spillOffset + 3]).toBeLessThan(250);
    expect(result.image.data[spillOffset]).toBeLessThan(
      (source.data[spillOffset] ?? 0) - 8,
    );
    expect(rgbDistance(mattedColor, background)).toBeGreaterThan(
      rgbDistance(sourceColor, background) + 10,
    );
  });

  it("simple matting 无法从背景色区分主体时应标记椭圆兜底", () => {
    const result = applyLayeredDesignSimpleSubjectMattingToRgba(
      createSyntheticFlatBackgroundCrop(),
    );
    const centerOffset = (4 * result.image.width + 4) * 4;
    const cornerOffset = 0;

    expect(result.ellipseFallbackApplied).toBe(true);
    expect(result.detectedForegroundPixelCount).toBe(0);
    expect(result.foregroundPixelCount).toBeGreaterThan(0);
    expect(result.image.data[centerOffset + 3]).toBeGreaterThan(220);
    expect(result.image.data[cornerOffset + 3]).toBeLessThan(80);
  });

  it("simple matting provider 应输出真实 matted image 与 mask data URL", async () => {
    const encodedImages: LayeredDesignSubjectMattingPixelImage[] = [];
    const provider = createLayeredDesignSimpleSubjectMattingProvider({
      label: "Simple subject matting fixture",
      confidence: 0.9,
      rasterAdapter: {
        decodePngDataUrl: vi.fn(async () => createSyntheticSubjectCrop()),
        encodePngDataUrl: vi.fn(async (image) => {
          encodedImages.push(image);
          return `data:image/png;base64,encoded-${encodedImages.length}`;
        }),
      },
    });

    await expect(
      provider.matteSubject({
        image: {
          src: "data:image/png;base64,flat",
          width: 900,
          height: 1400,
          mimeType: "image/png",
        },
        createdAt: CREATED_AT,
        subject: {
          id: "subject-candidate",
          name: "主体候选",
          rect: {
            x: 144,
            y: 224,
            width: 612,
            height: 980,
          },
          confidence: 0.74,
          zIndex: 20,
          crop: {
            src: "data:image/png;base64,subject-crop",
            width: 612,
            height: 980,
            mimeType: "image/png",
          },
        },
      }),
    ).resolves.toEqual({
      imageSrc: "data:image/png;base64,encoded-1",
      maskSrc: "data:image/png;base64,encoded-2",
      rect: {
        x: 144,
        y: 224,
        width: 612,
        height: 980,
      },
      confidence: 0.9,
      hasAlpha: true,
      params: {
        seed: "simple_subject_matting_color_distance_v6",
        edgeColorSpillSuppressed: true,
        alphaHoleFilledPixelCount: 0,
        foregroundPixelCount: expect.any(Number),
        detectedForegroundPixelCount: expect.any(Number),
        ellipseFallbackApplied: false,
        totalPixelCount: 25,
      },
    });
    expect(encodedImages).toHaveLength(2);
    expect(encodedImages[0].data[3]).toBeLessThan(16);
    expect(encodedImages[1].data[3]).toBe(255);
  });
});
