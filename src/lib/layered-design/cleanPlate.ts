import type { LayeredDesignFlatImageStructuredAnalyzerProviderInput } from "./analyzer";
import type { LayeredDesignFlatImageHeuristicCropRect } from "./flatImageHeuristics";
import type {
  LayeredDesignWorkerHeuristicCleanPlateRefiner,
  LayeredDesignWorkerHeuristicCleanPlateResult,
} from "./structuredAnalyzerWorkerHeuristic";

export interface LayeredDesignCleanPlateSubjectInput {
  id: string;
  name: string;
  rect: LayeredDesignFlatImageHeuristicCropRect;
  confidence: number;
  zIndex: number;
  crop: {
    src: string;
    width: number;
    height: number;
    mimeType: "image/png";
  };
  maskSrc?: string;
}

export interface LayeredDesignCleanPlateInput {
  image: LayeredDesignFlatImageStructuredAnalyzerProviderInput["image"];
  createdAt: string;
  subject: LayeredDesignCleanPlateSubjectInput;
}

export interface LayeredDesignCleanPlateResult {
  src: string;
  message?: string;
  params?: Record<string, unknown>;
}

export interface LayeredDesignCleanPlateProvider {
  label: string;
  createCleanPlate: (
    input: LayeredDesignCleanPlateInput,
  ) => Promise<LayeredDesignCleanPlateResult | null>;
}

export interface CreateLayeredDesignDeterministicCleanPlateProviderOptions {
  label?: string;
  src?: string;
  message?: string;
  params?: Record<string, unknown>;
}

export interface LayeredDesignCleanPlatePixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface LayeredDesignCleanPlateRasterAdapter {
  decodePngDataUrl: (src: string) => Promise<LayeredDesignCleanPlatePixelImage>;
  encodePngDataUrl: (
    image: LayeredDesignCleanPlatePixelImage,
  ) => Promise<string>;
}

export interface CreateLayeredDesignSimpleCleanPlateProviderOptions {
  label?: string;
  message?: string;
  rasterAdapter?: LayeredDesignCleanPlateRasterAdapter;
}

const TRANSPARENT_PIXEL_CLEAN_PLATE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8I4WQAAAABJRU5ErkJggg==";
const SIMPLE_CLEAN_PLATE_MODEL_ID = "simple_neighbor_inpaint_v1";
const SIMPLE_CLEAN_PLATE_ALGORITHM_VERSION = 2;
const CLEAN_PLATE_MASK_FILL_THRESHOLD = 0.08;

type CleanPlatePixel = readonly [number, number, number, number];

interface CleanPlateRectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CleanPlateWeightedSample {
  pixel: CleanPlatePixel;
  weight: number;
}

interface CleanPlateTargetCoverageMap {
  left: number;
  top: number;
  width: number;
  height: number;
  values: Float32Array;
}

const CLEAN_PLATE_SAMPLE_DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

function clampByte(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

function clampCoordinate(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function getPixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function clonePixelImage(
  image: LayeredDesignCleanPlatePixelImage,
): LayeredDesignCleanPlatePixelImage {
  const data = new Uint8ClampedArray(image.data.length);
  data.set(image.data);

  return {
    width: Math.max(1, Math.round(image.width)),
    height: Math.max(1, Math.round(image.height)),
    data,
  };
}

function readMaskCoverage(
  mask: LayeredDesignCleanPlatePixelImage | undefined,
  rect: LayeredDesignFlatImageHeuristicCropRect,
  x: number,
  y: number,
): number {
  if (!mask) {
    return 1;
  }

  const maskX = clampCoordinate(
    ((x - rect.x) / Math.max(1, rect.width)) * mask.width,
    0,
    mask.width - 1,
  );
  const maskY = clampCoordinate(
    ((y - rect.y) / Math.max(1, rect.height)) * mask.height,
    0,
    mask.height - 1,
  );
  const offset = getPixelOffset(mask.width, maskX, maskY);
  const rgbCoverage =
    ((mask.data[offset] ?? 0) +
      (mask.data[offset + 1] ?? 0) +
      (mask.data[offset + 2] ?? 0)) /
    (255 * 3);
  const alphaCoverage = (mask.data[offset + 3] ?? 255) / 255;

  return Math.max(
    0,
    Math.min(1, Math.max(rgbCoverage, alphaCoverage < 1 ? alphaCoverage : 0)),
  );
}

function readPixel(
  image: LayeredDesignCleanPlatePixelImage,
  x: number,
  y: number,
): CleanPlatePixel {
  const offset = getPixelOffset(
    image.width,
    clampCoordinate(x, 0, image.width - 1),
    clampCoordinate(y, 0, image.height - 1),
  );

  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
    image.data[offset + 3] ?? 255,
  ] as const;
}

function pushCleanPlateSample(
  samples: CleanPlateWeightedSample[],
  pixel: CleanPlatePixel,
  weight: number,
) {
  if (weight > 0) {
    samples.push({ pixel, weight });
  }
}

function averageCleanPlateSamples(
  samples: CleanPlateWeightedSample[],
  fallback: CleanPlatePixel,
): [number, number, number, number] {
  if (samples.length === 0) {
    return [...fallback];
  }

  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);

  return [0, 1, 2, 3].map((channel) =>
    clampByte(
      samples.reduce(
        (sum, sample) => sum + sample.pixel[channel] * sample.weight,
        0,
      ) / Math.max(totalWeight, Number.EPSILON),
    ),
  ) as [number, number, number, number];
}

function getRgbDistance(
  left: CleanPlatePixel,
  right: CleanPlatePixel,
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function isInsideRectBounds(
  rect: CleanPlateRectBounds,
  x: number,
  y: number,
): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function readTargetCoverageAt(
  coverageMap: CleanPlateTargetCoverageMap,
  x: number,
  y: number,
): number {
  if (
    x < coverageMap.left ||
    y < coverageMap.top ||
    x >= coverageMap.left + coverageMap.width ||
    y >= coverageMap.top + coverageMap.height
  ) {
    return 0;
  }

  return (
    coverageMap.values[
      (y - coverageMap.top) * coverageMap.width + (x - coverageMap.left)
    ] ?? 0
  );
}

function createTargetCoverageMap(
  mask: LayeredDesignCleanPlatePixelImage | undefined,
  sourceRect: LayeredDesignFlatImageHeuristicCropRect,
  bounds: CleanPlateRectBounds,
): CleanPlateTargetCoverageMap {
  const width = bounds.right - bounds.left + 1;
  const height = bounds.bottom - bounds.top + 1;
  const values = new Float32Array(width * height);

  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      values[(y - bounds.top) * width + (x - bounds.left)] = readMaskCoverage(
        mask,
        sourceRect,
        x,
        y,
      );
    }
  }

  return {
    left: bounds.left,
    top: bounds.top,
    width,
    height,
    values,
  };
}

function weightedCleanPlatePixel(
  image: LayeredDesignCleanPlatePixelImage,
  rect: CleanPlateRectBounds,
  x: number,
  y: number,
): [number, number, number, number] {
  const leftDistance = Math.max(1, x - rect.left + 1);
  const rightDistance = Math.max(1, rect.right - x + 1);
  const topDistance = Math.max(1, y - rect.top + 1);
  const bottomDistance = Math.max(1, rect.bottom - y + 1);
  const samples: CleanPlateWeightedSample[] = [];

  if (rect.left > 0) {
    pushCleanPlateSample(
      samples,
      readPixel(image, rect.left - 1, y),
      1 / leftDistance,
    );
  }
  if (rect.right < image.width - 1) {
    pushCleanPlateSample(
      samples,
      readPixel(image, rect.right + 1, y),
      1 / rightDistance,
    );
  }
  if (rect.top > 0) {
    pushCleanPlateSample(
      samples,
      readPixel(image, x, rect.top - 1),
      1 / topDistance,
    );
  }
  if (rect.bottom < image.height - 1) {
    pushCleanPlateSample(
      samples,
      readPixel(image, x, rect.bottom + 1),
      1 / bottomDistance,
    );
  }
  if (rect.left > 0 && rect.top > 0) {
    pushCleanPlateSample(
      samples,
      readPixel(image, rect.left - 1, rect.top - 1),
      1 / Math.hypot(leftDistance, topDistance),
    );
  }
  if (rect.right < image.width - 1 && rect.top > 0) {
    pushCleanPlateSample(
      samples,
      readPixel(image, rect.right + 1, rect.top - 1),
      1 / Math.hypot(rightDistance, topDistance),
    );
  }
  if (rect.left > 0 && rect.bottom < image.height - 1) {
    pushCleanPlateSample(
      samples,
      readPixel(image, rect.left - 1, rect.bottom + 1),
      1 / Math.hypot(leftDistance, bottomDistance),
    );
  }
  if (rect.right < image.width - 1 && rect.bottom < image.height - 1) {
    pushCleanPlateSample(
      samples,
      readPixel(image, rect.right + 1, rect.bottom + 1),
      1 / Math.hypot(rightDistance, bottomDistance),
    );
  }

  return averageCleanPlateSamples(samples, readPixel(image, x, y));
}

function collectLocalCleanPlateSamples(
  image: LayeredDesignCleanPlatePixelImage,
  bounds: CleanPlateRectBounds,
  coverageMap: CleanPlateTargetCoverageMap,
  x: number,
  y: number,
  sourcePixel: CleanPlatePixel,
): CleanPlateWeightedSample[] {
  const maxSampleDistance = Math.min(
    12,
    Math.max(
      2,
      Math.ceil(Math.max(coverageMap.width, coverageMap.height) * 0.04),
    ),
  );
  const samples: CleanPlateWeightedSample[] = [];

  for (const [directionX, directionY] of CLEAN_PLATE_SAMPLE_DIRECTIONS) {
    for (let distance = 1; distance <= maxSampleDistance; distance += 1) {
      const sampleX = x + directionX * distance;
      const sampleY = y + directionY * distance;
      if (
        sampleX < 0 ||
        sampleY < 0 ||
        sampleX >= image.width ||
        sampleY >= image.height
      ) {
        break;
      }

      if (
        isInsideRectBounds(bounds, sampleX, sampleY) &&
        readTargetCoverageAt(coverageMap, sampleX, sampleY) >
          CLEAN_PLATE_MASK_FILL_THRESHOLD
      ) {
        continue;
      }

      const pixel = readPixel(image, sampleX, sampleY);
      if (getRgbDistance(pixel, sourcePixel) <= 12) {
        continue;
      }

      pushCleanPlateSample(samples, pixel, 1 / distance);
      break;
    }
  }

  return samples;
}

function smoothCleanPlateFilledEdges(
  image: LayeredDesignCleanPlatePixelImage,
  bounds: CleanPlateRectBounds,
  coverageMap: CleanPlateTargetCoverageMap,
): LayeredDesignCleanPlatePixelImage {
  const output = clonePixelImage(image);

  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      const coverage = readTargetCoverageAt(coverageMap, x, y);
      if (coverage <= CLEAN_PLATE_MASK_FILL_THRESHOLD) {
        continue;
      }

      const samples: CleanPlateWeightedSample[] = [];
      let touchesKnownPixel = false;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }

          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          if (
            sampleX < 0 ||
            sampleY < 0 ||
            sampleX >= image.width ||
            sampleY >= image.height
          ) {
            touchesKnownPixel = true;
            continue;
          }

          const neighborCoverage = readTargetCoverageAt(
            coverageMap,
            sampleX,
            sampleY,
          );
          if (neighborCoverage <= CLEAN_PLATE_MASK_FILL_THRESHOLD) {
            touchesKnownPixel = true;
          }

          pushCleanPlateSample(
            samples,
            readPixel(image, sampleX, sampleY),
            neighborCoverage <= CLEAN_PLATE_MASK_FILL_THRESHOLD ? 1 : 0.45,
          );
        }
      }

      if (!touchesKnownPixel || samples.length === 0) {
        continue;
      }

      const offset = getPixelOffset(image.width, x, y);
      const current = readPixel(image, x, y);
      const smoothed = averageCleanPlateSamples(samples, current);
      const strength = coverage >= 0.98 ? 0.16 : 0.35;

      output.data[offset] = clampByte(
        current[0] * (1 - strength) + smoothed[0] * strength,
      );
      output.data[offset + 1] = clampByte(
        current[1] * (1 - strength) + smoothed[1] * strength,
      );
      output.data[offset + 2] = clampByte(
        current[2] * (1 - strength) + smoothed[2] * strength,
      );
      output.data[offset + 3] = clampByte(
        current[3] * (1 - strength) + smoothed[3] * strength,
      );
    }
  }

  return output;
}

export function applyLayeredDesignSimpleCleanPlateInpaintToRgba(
  image: LayeredDesignCleanPlatePixelImage,
  rect: LayeredDesignFlatImageHeuristicCropRect,
  mask?: LayeredDesignCleanPlatePixelImage,
): {
  image: LayeredDesignCleanPlatePixelImage;
  filledPixelCount: number;
  totalSubjectPixelCount: number;
} {
  let output = clonePixelImage(image);
  const left = clampCoordinate(rect.x, 0, output.width - 1);
  const top = clampCoordinate(rect.y, 0, output.height - 1);
  const right = clampCoordinate(rect.x + rect.width - 1, left, output.width - 1);
  const bottom = clampCoordinate(rect.y + rect.height - 1, top, output.height - 1);
  const bounds = { left, top, right, bottom };
  const coverageMap = createTargetCoverageMap(mask, rect, bounds);
  let filledPixelCount = 0;
  let totalSubjectPixelCount = 0;

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const coverage = readTargetCoverageAt(coverageMap, x, y);
      if (coverage <= CLEAN_PLATE_MASK_FILL_THRESHOLD) {
        continue;
      }

      totalSubjectPixelCount += 1;
      const sourceOffset = getPixelOffset(output.width, x, y);
      const sourcePixel = readPixel(image, x, y);
      const localSamples = collectLocalCleanPlateSamples(
        image,
        bounds,
        coverageMap,
        x,
        y,
        sourcePixel,
      );
      const fill =
        localSamples.length > 0
          ? averageCleanPlateSamples(localSamples, sourcePixel)
          : weightedCleanPlatePixel(image, bounds, x, y);

      output.data[sourceOffset] = clampByte(
        fill[0] * coverage + (image.data[sourceOffset] ?? 0) * (1 - coverage),
      );
      output.data[sourceOffset + 1] = clampByte(
        fill[1] * coverage +
          (image.data[sourceOffset + 1] ?? 0) * (1 - coverage),
      );
      output.data[sourceOffset + 2] = clampByte(
        fill[2] * coverage +
          (image.data[sourceOffset + 2] ?? 0) * (1 - coverage),
      );
      output.data[sourceOffset + 3] = clampByte(
        fill[3] * coverage +
          (image.data[sourceOffset + 3] ?? 255) * (1 - coverage),
      );
      filledPixelCount += 1;
    }
  }

  output = smoothCleanPlateFilledEdges(output, bounds, coverageMap);

  return {
    image: output,
    filledPixelCount,
    totalSubjectPixelCount,
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

function createDefaultBrowserCleanPlateRasterAdapter():
  | LayeredDesignCleanPlateRasterAdapter
  | null {
  if (
    typeof OffscreenCanvas !== "function" ||
    typeof createImageBitmap !== "function" ||
    typeof fetch !== "function" ||
    typeof btoa !== "function"
  ) {
    return null;
  }

  return {
    decodePngDataUrl: async (src) => {
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error(`clean plate 读取图片失败：HTTP ${response.status}`);
      }

      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(
        Math.max(1, bitmap.width),
        Math.max(1, bitmap.height),
      );
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("当前 Worker 环境不支持 clean plate 2D Canvas");
      }

      context.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

      return {
        width: canvas.width,
        height: canvas.height,
        data: imageData.data,
      };
    },
    encodePngDataUrl: async (image) => {
      const rgba = new Uint8ClampedArray(image.data.length);
      rgba.set(image.data);
      const canvas = new OffscreenCanvas(
        Math.max(1, image.width),
        Math.max(1, image.height),
      );
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("当前 Worker 环境不支持 clean plate PNG 编码");
      }

      context.putImageData(
        new ImageData(rgba, image.width, image.height),
        0,
        0,
      );
      return await blobToDataUrl(
        await canvas.convertToBlob({ type: "image/png" }),
      );
    },
  };
}

function normalizeCleanPlateResult(
  result: LayeredDesignCleanPlateResult | null,
): LayeredDesignWorkerHeuristicCleanPlateResult | null {
  const src = result?.src.trim();
  if (!result || !src) {
    return null;
  }

  return {
    src,
    ...(result.message ? { message: result.message } : {}),
    ...(result.params ? { params: { ...result.params } } : {}),
  };
}

export function createLayeredDesignDeterministicCleanPlateProvider(
  options: CreateLayeredDesignDeterministicCleanPlateProviderOptions = {},
): LayeredDesignCleanPlateProvider {
  const src = options.src?.trim() || TRANSPARENT_PIXEL_CLEAN_PLATE_DATA_URL;

  return {
    label: options.label ?? "Deterministic clean plate placeholder",
    createCleanPlate: async (input) => ({
      src,
      message:
        options.message ??
        "当前 clean plate 来自 deterministic provider 占位，不是真 inpaint。",
      params: {
        provider: options.label ?? "Deterministic clean plate placeholder",
        sourceRect: { ...input.subject.rect },
        ...(options.params ?? {}),
      },
    }),
  };
}

export function createLayeredDesignSimpleCleanPlateProvider(
  options: CreateLayeredDesignSimpleCleanPlateProviderOptions = {},
): LayeredDesignCleanPlateProvider {
  const rasterAdapter =
    options.rasterAdapter ?? createDefaultBrowserCleanPlateRasterAdapter();

  return {
    label: options.label ?? "Simple browser clean plate provider",
    createCleanPlate: async (input) => {
      if (!rasterAdapter) {
        throw new Error("当前环境不支持简单 clean plate 像素修补");
      }

      const source = await rasterAdapter.decodePngDataUrl(input.image.src);
      const mask = input.subject.maskSrc
        ? await rasterAdapter.decodePngDataUrl(input.subject.maskSrc)
        : undefined;
      const result = applyLayeredDesignSimpleCleanPlateInpaintToRgba(
        source,
        input.subject.rect,
        mask,
      );

      return {
        src: await rasterAdapter.encodePngDataUrl(result.image),
        message:
          options.message ??
          "当前 clean plate 来自简单像素级邻域修补，不是真模型 inpaint；进入编辑后仍需核对主体原位置纹理。",
        params: {
          provider: options.label ?? "Simple browser clean plate provider",
          model: SIMPLE_CLEAN_PLATE_MODEL_ID,
          algorithm: "coverage_aware_directional_inpaint",
          algorithmVersion: SIMPLE_CLEAN_PLATE_ALGORITHM_VERSION,
          sourceRect: { ...input.subject.rect },
          filledPixelCount: result.filledPixelCount,
          totalSubjectPixelCount: result.totalSubjectPixelCount,
          maskApplied: Boolean(mask),
        },
      };
    },
  };
}

export function createLayeredDesignWorkerCleanPlateRefinerFromProvider(
  provider: LayeredDesignCleanPlateProvider,
): LayeredDesignWorkerHeuristicCleanPlateRefiner {
  return async (input) => {
    try {
      return normalizeCleanPlateResult(
        await provider.createCleanPlate({
          image: input.image,
          createdAt: input.createdAt,
          subject: {
            id: input.subject.id,
            name: input.subject.name,
            rect: { ...input.subject.rect },
            confidence: input.subject.confidence,
            zIndex: input.subject.zIndex,
            crop: { ...input.subject.crop },
            ...(input.subject.maskSrc ? { maskSrc: input.subject.maskSrc } : {}),
          },
        }),
      );
    } catch {
      return null;
    }
  };
}
