import { describe, expect, it, vi } from "vitest";
import { createLayeredDesignFlatImageAnalyzerFromStructuredProvider } from "./analyzer";
import {
  applyLayeredDesignSimpleCleanPlateInpaintToRgba,
  createLayeredDesignWorkerCleanPlateRefinerFromProvider,
  createLayeredDesignDeterministicCleanPlateProvider,
  createLayeredDesignSimpleCleanPlateProvider,
  type LayeredDesignCleanPlatePixelImage,
} from "./cleanPlate";
import { createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider } from "./structuredAnalyzerWorkerHeuristic";

const CREATED_AT = "2026-05-07T00:00:00.000Z";

function createPixelImage(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => [number, number, number, number],
): LayeredDesignCleanPlatePixelImage {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = colorAt(x, y);
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = alpha;
    }
  }

  return { width, height, data };
}

function readPixel(
  image: LayeredDesignCleanPlatePixelImage,
  x: number,
  y: number,
) {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset],
    image.data[offset + 1],
    image.data[offset + 2],
    image.data[offset + 3],
  ];
}

function rgbDistance(
  left: Array<number | undefined>,
  right: ReadonlyArray<number | undefined>,
): number {
  return Math.hypot(
    (left[0] ?? 0) - (right[0] ?? 0),
    (left[1] ?? 0) - (right[1] ?? 0),
    (left[2] ?? 0) - (right[2] ?? 0),
  );
}

function createRasterizerFactory() {
  return vi.fn(async () => ({
    cropImageToPngDataUrl: vi.fn(async (rect) => {
      return `data:image/png;base64,crop-${rect.x}-${rect.y}`;
    }),
    cropImageWithEllipseMaskToPngDataUrl: vi.fn(async () => {
      return "data:image/png;base64,masked";
    }),
    createRefinedSubjectMaskDataUrl: vi.fn(async () => {
      return "data:image/png;base64,subject-mask";
    }),
    createEllipseMaskDataUrl: vi.fn(async () => {
      return "data:image/png;base64,ellipse-mask";
    }),
    createRefinedCleanPlateDataUrl: vi.fn(async () => {
      return "data:image/png;base64,refined-clean";
    }),
    createApproximateCleanPlateDataUrl: vi.fn(async () => {
      return "data:image/png;base64,approx-clean";
    }),
  }));
}

describe("LayeredDesign clean plate provider seam", () => {
  it("简单 clean plate 算法应按主体 rect 用周边像素修补原位置", () => {
    const image = createPixelImage(5, 5, (x, y) => {
      if (x >= 1 && x <= 3 && y >= 1 && y <= 3) {
        return [240, 32, 32, 255];
      }
      return [20 + x * 20, 80 + y * 10, 160, 255];
    });

    const result = applyLayeredDesignSimpleCleanPlateInpaintToRgba(image, {
      x: 1,
      y: 1,
      width: 3,
      height: 3,
    });

    expect(result.filledPixelCount).toBe(9);
    expect(result.totalSubjectPixelCount).toBe(9);
    expect(readPixel(result.image, 2, 2)).not.toEqual([240, 32, 32, 255]);
    expect(readPixel(result.image, 0, 0)).toEqual(readPixel(image, 0, 0));
  });

  it("简单 clean plate 算法应优先使用 mask 周边真实背景修补主体洞", () => {
    const innerBackground: [number, number, number, number] = [
      32, 150, 92, 255,
    ];
    const outerBackground: [number, number, number, number] = [
      24, 72, 190, 255,
    ];
    const subject: [number, number, number, number] = [238, 42, 42, 255];
    const image = createPixelImage(7, 5, (x, y) => {
      if (x === 3 && y === 2) {
        return subject;
      }
      if (x >= 1 && x <= 5 && y >= 1 && y <= 3) {
        return innerBackground;
      }
      return outerBackground;
    });
    const mask = createPixelImage(5, 3, (x, y) =>
      x === 2 && y === 1 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );

    const result = applyLayeredDesignSimpleCleanPlateInpaintToRgba(
      image,
      {
        x: 1,
        y: 1,
        width: 5,
        height: 3,
      },
      mask,
    );
    const center = readPixel(result.image, 3, 2);

    expect(result.filledPixelCount).toBe(1);
    expect(rgbDistance(center, innerBackground)).toBeLessThan(
      rgbDistance(center, outerBackground),
    );
    expect(readPixel(result.image, 2, 2)).toEqual(readPixel(image, 2, 2));
  });

  it("简单 clean plate provider 应输出真实像素级修补结果与元数据", async () => {
    const source = createPixelImage(5, 5, (x, y) => {
      if (x >= 1 && x <= 3 && y >= 1 && y <= 3) {
        return [220, 40, 40, 255];
      }
      return [40, 120, 200, 255];
    });
    const mask = createPixelImage(3, 3, (x, y) =>
      x === 1 && y === 1 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    let encodedImage: LayeredDesignCleanPlatePixelImage | null = null;
    const provider = createLayeredDesignSimpleCleanPlateProvider({
      label: "Simple clean plate fixture",
      rasterAdapter: {
        decodePngDataUrl: vi.fn(async (src) => {
          if (src === "data:image/png;base64,mask") {
            return mask;
          }
          return source;
        }),
        encodePngDataUrl: vi.fn(async (image) => {
          encodedImage = image;
          return "data:image/png;base64,simple-clean";
        }),
      },
    });

    await expect(
      provider.createCleanPlate({
        image: {
          src: "data:image/png;base64,flat",
          width: 5,
          height: 5,
          mimeType: "image/png",
        },
        createdAt: CREATED_AT,
        subject: {
          id: "subject-candidate",
          name: "主体候选",
          rect: { x: 1, y: 1, width: 3, height: 3 },
          confidence: 0.74,
          zIndex: 20,
          crop: {
            src: "data:image/png;base64,crop",
            width: 3,
            height: 3,
            mimeType: "image/png",
          },
          maskSrc: "data:image/png;base64,mask",
        },
      }),
    ).resolves.toMatchObject({
      src: "data:image/png;base64,simple-clean",
      message: expect.stringContaining("简单像素级邻域修补"),
      params: {
        provider: "Simple clean plate fixture",
        model: "simple_neighbor_inpaint_v1",
        algorithm: "coverage_aware_directional_inpaint",
        algorithmVersion: 2,
        filledPixelCount: 1,
        totalSubjectPixelCount: 1,
        maskApplied: true,
      },
    });
    expect(encodedImage).not.toBeNull();
    expect(readPixel(encodedImage!, 2, 2)).not.toEqual([220, 40, 40, 255]);
    expect(readPixel(encodedImage!, 1, 1)).toEqual([220, 40, 40, 255]);
  });

  it("应把 clean plate provider 包装成 Worker cleanPlateRefiner 并写回 current extraction", async () => {
    const createCleanPlate = vi.fn(async (input) => ({
      src: `data:image/png;base64,clean-${input.subject.rect.width}`,
      message: "测试 clean plate provider 已生成背景修补。",
      params: {
        provider: "Fixture clean plate provider",
        model: "fixture-inpaint",
      },
    }));
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        cleanPlateRefiner:
          createLayeredDesignWorkerCleanPlateRefinerFromProvider({
            label: "Fixture clean plate provider",
            createCleanPlate,
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

    expect(createCleanPlate).toHaveBeenCalledWith({
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
        maskSrc: "data:image/png;base64,subject-mask",
      }),
    });
    expect(result.analysis.outputs?.cleanPlate).toBe(true);
    expect(result.cleanPlate).toMatchObject({
      status: "succeeded",
      message: "测试 clean plate provider 已生成背景修补。",
      asset: {
        id: "worker-heuristic-clean-plate-asset",
        kind: "clean_plate",
        src: "data:image/png;base64,clean-612",
        params: {
          seed: "worker_heuristic_clean_plate_provider",
          provider: "Fixture clean plate provider",
          model: "fixture-inpaint",
        },
      },
    });
  });

  it("clean plate provider 无结果或失败时应回退 Worker heuristic clean plate", async () => {
    const createCleanPlate = vi.fn(async () => null);
    const provider =
      createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider({
        cleanPlateRefiner:
          createLayeredDesignWorkerCleanPlateRefinerFromProvider({
            label: "Empty clean plate provider",
            createCleanPlate,
          }),
        rasterizerFactory: createRasterizerFactory(),
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

    expect(createCleanPlate).toHaveBeenCalledTimes(1);
    expect(result.cleanPlate).toMatchObject({
      asset: {
        src: "data:image/png;base64,refined-clean",
        params: {
          seed: "worker_heuristic_refined_clean_plate",
        },
      },
      message: expect.stringContaining("不是真 inpaint"),
    });
  });

  it("deterministic clean plate provider 应输出可预测占位结果", async () => {
    const provider = createLayeredDesignDeterministicCleanPlateProvider({
      label: "Deterministic clean plate fixture",
      src: "data:image/png;base64,deterministic-clean",
      params: {
        model: "deterministic",
      },
    });

    await expect(
      provider.createCleanPlate({
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
            src: "data:image/png;base64,crop",
            width: 612,
            height: 980,
            mimeType: "image/png",
          },
        },
      }),
    ).resolves.toMatchObject({
      src: "data:image/png;base64,deterministic-clean",
      message: expect.stringContaining("deterministic provider"),
      params: {
        provider: "Deterministic clean plate fixture",
        model: "deterministic",
        sourceRect: {
          x: 144,
          y: 224,
          width: 612,
          height: 980,
        },
      },
    });
  });
});
