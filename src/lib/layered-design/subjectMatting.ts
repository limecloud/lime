import type { LayeredDesignFlatImageStructuredAnalyzerProviderInput } from "./analyzer";
import type { LayeredDesignFlatImageHeuristicCropRect } from "./flatImageHeuristics";
import type {
  LayeredDesignWorkerHeuristicSubjectMaskRefiner,
  LayeredDesignWorkerHeuristicSubjectMaskResult,
} from "./structuredAnalyzerWorkerHeuristic";

const OPAQUE_WHITE_PIXEL_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/l8I4WQAAAABJRU5ErkJggg==";

export interface LayeredDesignSubjectMattingCandidateInput {
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
}

export interface LayeredDesignSubjectMattingInput {
  image: LayeredDesignFlatImageStructuredAnalyzerProviderInput["image"];
  createdAt: string;
  subject: LayeredDesignSubjectMattingCandidateInput;
}

export interface LayeredDesignSubjectMattingResult {
  imageSrc: string;
  maskSrc: string;
  rect?: LayeredDesignFlatImageHeuristicCropRect;
  confidence?: number;
  hasAlpha?: boolean;
  params?: Record<string, unknown>;
}

export interface LayeredDesignSubjectMattingProvider {
  label: string;
  matteSubject: (
    input: LayeredDesignSubjectMattingInput,
  ) => Promise<LayeredDesignSubjectMattingResult | null>;
}

export interface CreateLayeredDesignDeterministicSubjectMattingProviderOptions {
  label?: string;
  confidence?: number;
  maskSrc?: string;
}

export interface LayeredDesignSubjectMattingPixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface LayeredDesignSubjectMattingRasterAdapter {
  decodePngDataUrl: (
    src: string,
  ) => Promise<LayeredDesignSubjectMattingPixelImage>;
  encodePngDataUrl: (
    image: LayeredDesignSubjectMattingPixelImage,
  ) => Promise<string>;
}

export interface CreateLayeredDesignSimpleSubjectMattingProviderOptions {
  label?: string;
  confidence?: number;
  rasterAdapter?: LayeredDesignSubjectMattingRasterAdapter;
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

interface AlphaComponent {
  pixels: number[];
  area: number;
  alphaSum: number;
  centerX: number;
  centerY: number;
}

interface SubjectAlphaRefinementResult {
  alpha: Uint8ClampedArray;
  filledHolePixelCount: number;
}

function clampConfidence(value: number | undefined, fallback: number): number {
  const candidate = Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(candidate ?? 0, 0), 1);
}

function clampByte(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function createTransparentPixelImage(width: number, height: number) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

function getPixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function sampleBorderBackgroundColor(
  image: LayeredDesignSubjectMattingPixelImage,
): RgbColor {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(Math.min(image.width, image.height) / 16));

  for (let x = 0; x < image.width; x += step) {
    for (const y of [0, image.height - 1]) {
      const offset = getPixelOffset(image.width, x, y);
      red += image.data[offset] ?? 0;
      green += image.data[offset + 1] ?? 0;
      blue += image.data[offset + 2] ?? 0;
      count += 1;
    }
  }

  for (let y = 0; y < image.height; y += step) {
    for (const x of [0, image.width - 1]) {
      const offset = getPixelOffset(image.width, x, y);
      red += image.data[offset] ?? 0;
      green += image.data[offset + 1] ?? 0;
      blue += image.data[offset + 2] ?? 0;
      count += 1;
    }
  }

  return {
    red: red / Math.max(1, count),
    green: green / Math.max(1, count),
    blue: blue / Math.max(1, count),
  };
}

function computeEllipseAlpha(width: number, height: number, x: number, y: number) {
  const rx = Math.max(1, width * 0.48);
  const ry = Math.max(1, height * 0.5);
  const dx = (x + 0.5 - width / 2) / rx;
  const dy = (y + 0.5 - height / 2) / ry;
  const radius = Math.sqrt(dx * dx + dy * dy);

  return 1 - smoothstep(0.78, 1.04, radius);
}

function computeColorDistanceAlpha(
  image: LayeredDesignSubjectMattingPixelImage,
  background: RgbColor,
  x: number,
  y: number,
): number {
  const offset = getPixelOffset(image.width, x, y);
  const red = image.data[offset] ?? 0;
  const green = image.data[offset + 1] ?? 0;
  const blue = image.data[offset + 2] ?? 0;
  const distance = Math.sqrt(
    (red - background.red) ** 2 +
      (green - background.green) ** 2 +
      (blue - background.blue) ** 2,
  );

  return smoothstep(42, 118, distance);
}

function suppressBackgroundColorSpill(
  source: Uint8ClampedArray,
  sourceOffset: number,
  background: RgbColor,
  alphaByte: number,
): [number, number, number] {
  const red = source[sourceOffset] ?? 0;
  const green = source[sourceOffset + 1] ?? 0;
  const blue = source[sourceOffset + 2] ?? 0;
  if (alphaByte <= 8 || alphaByte >= 250) {
    return [red, green, blue];
  }

  const alpha = Math.max(alphaByte / 255, 0.08);
  const strength = Math.min(0.82, (1 - alpha) * 1.15);
  const restoreForeground = (channel: number, backgroundChannel: number) => {
    const unmixed = (channel - backgroundChannel * (1 - alpha)) / alpha;
    return clampByte(channel * (1 - strength) + unmixed * strength);
  };

  return [
    restoreForeground(red, background.red),
    restoreForeground(green, background.green),
    restoreForeground(blue, background.blue),
  ];
}

function sampleAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }

  return alpha[y * width + x] ?? 0;
}

function collectAlphaComponents(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 48,
): AlphaComponent[] {
  const visited = new Uint8Array(alpha.length);
  const components: AlphaComponent[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex] || (alpha[startIndex] ?? 0) < threshold) {
        continue;
      }

      const stack = [startIndex];
      const pixels: number[] = [];
      let alphaSum = 0;
      let xSum = 0;
      let ySum = 0;
      visited[startIndex] = 1;

      while (stack.length > 0) {
        const index = stack.pop() ?? 0;
        const pixelX = index % width;
        const pixelY = Math.floor(index / width);
        const currentAlpha = alpha[index] ?? 0;

        pixels.push(index);
        alphaSum += currentAlpha;
        xSum += pixelX;
        ySum += pixelY;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (Math.abs(dx) + Math.abs(dy) !== 1) {
              continue;
            }

            const nextX = pixelX + dx;
            const nextY = pixelY + dy;
            if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
              continue;
            }

            const nextIndex = nextY * width + nextX;
            if (visited[nextIndex] || (alpha[nextIndex] ?? 0) < threshold) {
              continue;
            }

            visited[nextIndex] = 1;
            stack.push(nextIndex);
          }
        }
      }

      components.push({
        pixels,
        area: pixels.length,
        alphaSum,
        centerX: xSum / Math.max(1, pixels.length),
        centerY: ySum / Math.max(1, pixels.length),
      });
    }
  }

  return components;
}

function scoreAlphaComponent(
  component: AlphaComponent,
  width: number,
  height: number,
): number {
  const dx = component.centerX - (width - 1) / 2;
  const dy = component.centerY - (height - 1) / 2;
  const maxDistance = Math.max(1, Math.hypot(width / 2, height / 2));
  const centerWeight = 1 + (1 - Math.min(Math.hypot(dx, dy) / maxDistance, 1)) * 0.35;

  return component.alphaSum * centerWeight;
}

function keepDominantForegroundComponent(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const components = collectAlphaComponents(alpha, width, height);
  if (components.length <= 1) {
    return alpha;
  }

  const dominant = components.reduce((best, component) =>
    scoreAlphaComponent(component, width, height) >
    scoreAlphaComponent(best, width, height)
      ? component
      : best,
  );
  const minPreservedArea = Math.max(12, dominant.area * 0.42);
  const componentByPixel = new Map<number, AlphaComponent>();

  for (const component of components) {
    for (const pixel of component.pixels) {
      componentByPixel.set(pixel, component);
    }
  }

  const isolated = new Uint8ClampedArray(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    const component = componentByPixel.get(index);
    isolated[index] =
      !component || component === dominant || component.area >= minPreservedArea
        ? (alpha[index] ?? 0)
        : 0;
  }

  return isolated;
}

function fillEnclosedAlphaHoles(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): SubjectAlphaRefinementResult {
  const visited = new Uint8Array(alpha.length);
  const filled = new Uint8ClampedArray(alpha);
  const maxHoleArea = Math.max(16, Math.floor(width * height * 0.18));
  let filledHolePixelCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex] || (alpha[startIndex] ?? 0) >= 32) {
        continue;
      }

      const stack = [startIndex];
      const pixels: number[] = [];
      let touchesBorder = false;
      let boundaryAlphaSum = 0;
      let boundaryAlphaCount = 0;
      visited[startIndex] = 1;

      while (stack.length > 0) {
        const index = stack.pop() ?? 0;
        const pixelX = index % width;
        const pixelY = Math.floor(index / width);
        pixels.push(index);
        touchesBorder =
          touchesBorder ||
          pixelX === 0 ||
          pixelY === 0 ||
          pixelX === width - 1 ||
          pixelY === height - 1;

        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nextX = pixelX + dx;
          const nextY = pixelY + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            continue;
          }

          const nextIndex = nextY * width + nextX;
          const nextAlpha = alpha[nextIndex] ?? 0;
          if (nextAlpha < 32) {
            if (!visited[nextIndex]) {
              visited[nextIndex] = 1;
              stack.push(nextIndex);
            }
            continue;
          }

          if (nextAlpha >= 96) {
            boundaryAlphaSum += nextAlpha;
            boundaryAlphaCount += 1;
          }
        }
      }

      if (
        touchesBorder ||
        pixels.length > maxHoleArea ||
        boundaryAlphaCount < Math.max(4, Math.ceil(pixels.length * 0.5))
      ) {
        continue;
      }

      const fillAlpha = clampByte(
        (boundaryAlphaSum / Math.max(1, boundaryAlphaCount)) * 0.94,
      );
      for (const pixel of pixels) {
        filled[pixel] = fillAlpha;
      }
      filledHolePixelCount += pixels.length;
    }
  }

  return {
    alpha: filled,
    filledHolePixelCount,
  };
}

function refineSubjectAlphaMask(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): SubjectAlphaRefinementResult {
  const cleaned = new Uint8ClampedArray(alpha.length);
  const dominant = new Uint8ClampedArray(alpha.length);
  const refined = new Uint8ClampedArray(alpha.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const current = alpha[index] ?? 0;
      let strongNeighborCount = 0;
      let neighborAlphaSum = 0;
      let neighborCount = 0;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const neighborAlpha = sampleAlpha(alpha, width, height, x + dx, y + dy);
          neighborAlphaSum += neighborAlpha;
          neighborCount += 1;
          if (neighborAlpha >= 96) {
            strongNeighborCount += 1;
          }
        }
      }

      if (current >= 64 && strongNeighborCount <= 1) {
        cleaned[index] = 0;
      } else if (current < 32 && strongNeighborCount >= 5) {
        cleaned[index] = clampByte(neighborAlphaSum / Math.max(1, neighborCount));
      } else {
        cleaned[index] = current;
      }
    }
  }

  dominant.set(keepDominantForegroundComponent(cleaned, width, height));
  const holeFilled = fillEnclosedAlphaHoles(dominant, width, height);
  const fillReadyAlpha = holeFilled.alpha;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const current = fillReadyAlpha[index] ?? 0;
      let minNeighborAlpha = current;
      let maxNeighborAlpha = current;
      let neighborAlphaSum = current;
      let neighborCount = 1;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const neighborAlpha = sampleAlpha(
            fillReadyAlpha,
            width,
            height,
            x + dx,
            y + dy,
          );
          minNeighborAlpha = Math.min(minNeighborAlpha, neighborAlpha);
          maxNeighborAlpha = Math.max(maxNeighborAlpha, neighborAlpha);
          neighborAlphaSum += neighborAlpha;
          neighborCount += 1;
        }
      }

      const isEdge = minNeighborAlpha < 32 && maxNeighborAlpha > 160;
      refined[index] = isEdge
        ? clampByte(current * 0.62 + (neighborAlphaSum / neighborCount) * 0.38)
        : current;
    }
  }

  return {
    alpha: refined,
    filledHolePixelCount: holeFilled.filledHolePixelCount,
  };
}

export function applyLayeredDesignSimpleSubjectMattingToRgba(
  image: LayeredDesignSubjectMattingPixelImage,
): {
  image: LayeredDesignSubjectMattingPixelImage;
  mask: LayeredDesignSubjectMattingPixelImage;
  foregroundPixelCount: number;
  detectedForegroundPixelCount: number;
  ellipseFallbackApplied: boolean;
  filledHolePixelCount: number;
} {
  const width = Math.max(1, Math.round(image.width));
  const height = Math.max(1, Math.round(image.height));
  const source = image.data;
  const matted = createTransparentPixelImage(width, height);
  const mask = createTransparentPixelImage(width, height);
  const background = sampleBorderBackgroundColor({ width, height, data: source });
  const firstPassAlpha = new Uint8ClampedArray(width * height);
  let detectedForegroundPixelCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colorAlpha = computeColorDistanceAlpha(
        { width, height, data: source },
        background,
        x,
        y,
      );
      const ellipseAlpha = computeEllipseAlpha(width, height, x, y);
      const alpha = Math.max(
        colorAlpha,
        colorAlpha > 0.08 ? ellipseAlpha * 0.65 : 0,
      );
      const alphaByte = clampByte(
        alpha * ((source[getPixelOffset(width, x, y) + 3] ?? 255)),
      );
      firstPassAlpha[y * width + x] = alphaByte;
      if (alphaByte >= 32) {
        detectedForegroundPixelCount += 1;
      }
    }
  }

  const shouldUseEllipseFallback =
    detectedForegroundPixelCount < width * height * 0.05;
  const refinement = shouldUseEllipseFallback
    ? { alpha: firstPassAlpha, filledHolePixelCount: 0 }
    : refineSubjectAlphaMask(firstPassAlpha, width, height);
  const refinedAlpha = refinement.alpha;
  let refinedForegroundPixelCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = getPixelOffset(width, x, y);
      const alphaByte = shouldUseEllipseFallback
        ? clampByte(
            computeEllipseAlpha(width, height, x, y) *
              ((source[sourceOffset + 3] ?? 255)),
          )
        : (refinedAlpha[y * width + x] ?? 0);
      const targetOffset = getPixelOffset(width, x, y);
      const [red, green, blue] = shouldUseEllipseFallback
        ? [
            source[sourceOffset] ?? 0,
            source[sourceOffset + 1] ?? 0,
            source[sourceOffset + 2] ?? 0,
          ]
        : suppressBackgroundColorSpill(
            source,
            sourceOffset,
            background,
            alphaByte,
          );

      matted.data[targetOffset] = red;
      matted.data[targetOffset + 1] = green;
      matted.data[targetOffset + 2] = blue;
      matted.data[targetOffset + 3] = alphaByte;
      mask.data[targetOffset] = alphaByte;
      mask.data[targetOffset + 1] = alphaByte;
      mask.data[targetOffset + 2] = alphaByte;
      mask.data[targetOffset + 3] = 255;
      if (alphaByte >= 32) {
        refinedForegroundPixelCount += 1;
      }
    }
  }

  return {
    image: matted,
    mask,
    foregroundPixelCount: refinedForegroundPixelCount,
    detectedForegroundPixelCount,
    ellipseFallbackApplied: shouldUseEllipseFallback,
    filledHolePixelCount: refinement.filledHolePixelCount,
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

function createDefaultBrowserSubjectMattingRasterAdapter():
  | LayeredDesignSubjectMattingRasterAdapter
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
        throw new Error(`主体 matting 读取裁片失败：HTTP ${response.status}`);
      }

      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(
        Math.max(1, bitmap.width),
        Math.max(1, bitmap.height),
      );
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("当前 Worker 环境不支持主体 matting 2D Canvas");
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
        throw new Error("当前 Worker 环境不支持主体 matting PNG 编码");
      }

      context.putImageData(
        new ImageData(rgba, image.width, image.height),
        0,
        0,
      );
      return await blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
    },
  };
}

function normalizeSubjectMattingResult(
  result: LayeredDesignSubjectMattingResult | null,
): LayeredDesignWorkerHeuristicSubjectMaskResult | null {
  const imageSrc = result?.imageSrc.trim();
  const maskSrc = result?.maskSrc.trim();
  if (!result || !imageSrc || !maskSrc) {
    return null;
  }

  return {
    imageSrc,
    maskSrc,
    ...(result.rect ? { rect: { ...result.rect } } : {}),
    ...(typeof result.confidence === "number"
      ? { confidence: result.confidence }
      : {}),
    ...(typeof result.hasAlpha === "boolean"
      ? { hasAlpha: result.hasAlpha }
      : {}),
    ...(result.params ? { params: { ...result.params } } : {}),
  };
}

export function createLayeredDesignDeterministicSubjectMattingProvider(
  options: CreateLayeredDesignDeterministicSubjectMattingProviderOptions = {},
): LayeredDesignSubjectMattingProvider {
  const maskSrc = options.maskSrc?.trim() || OPAQUE_WHITE_PIXEL_PNG_DATA_URL;

  return {
    label: options.label ?? "Deterministic subject matting placeholder",
    matteSubject: async (input) => ({
      imageSrc: input.subject.crop.src,
      maskSrc,
      rect: { ...input.subject.rect },
      confidence: clampConfidence(options.confidence, input.subject.confidence),
      hasAlpha: true,
    }),
  };
}

export function createLayeredDesignSimpleSubjectMattingProvider(
  options: CreateLayeredDesignSimpleSubjectMattingProviderOptions = {},
): LayeredDesignSubjectMattingProvider {
  const rasterAdapter =
    options.rasterAdapter ?? createDefaultBrowserSubjectMattingRasterAdapter();

  return {
    label: options.label ?? "Simple browser subject matting provider",
    matteSubject: async (input) => {
      if (!rasterAdapter) {
        throw new Error("当前环境不支持简单主体 matting");
      }

      const source = await rasterAdapter.decodePngDataUrl(input.subject.crop.src);
      const result = applyLayeredDesignSimpleSubjectMattingToRgba(source);

      return {
        imageSrc: await rasterAdapter.encodePngDataUrl(result.image),
        maskSrc: await rasterAdapter.encodePngDataUrl(result.mask),
        rect: { ...input.subject.rect },
        confidence: clampConfidence(options.confidence, 0.94),
        hasAlpha: true,
        params: {
          seed: "simple_subject_matting_color_distance_v6",
          edgeColorSpillSuppressed: true,
          alphaHoleFilledPixelCount: result.filledHolePixelCount,
          foregroundPixelCount: result.foregroundPixelCount,
          detectedForegroundPixelCount: result.detectedForegroundPixelCount,
          ellipseFallbackApplied: result.ellipseFallbackApplied,
          totalPixelCount: source.width * source.height,
        },
      };
    },
  };
}

export function createLayeredDesignSubjectMaskRefinerFromMattingProvider(
  provider: LayeredDesignSubjectMattingProvider,
): LayeredDesignWorkerHeuristicSubjectMaskRefiner {
  return async (input) => {
    try {
      return normalizeSubjectMattingResult(
        await provider.matteSubject({
          image: input.image,
          createdAt: input.createdAt,
          subject: {
            id: input.candidate.id,
            name: input.candidate.name,
            rect: { ...input.candidate.rect },
            confidence: input.candidate.confidence,
            zIndex: input.candidate.zIndex,
            crop: { ...input.candidate.crop },
          },
        }),
      );
    } catch {
      return null;
    }
  };
}
