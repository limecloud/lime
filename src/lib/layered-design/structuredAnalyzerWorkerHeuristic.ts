import {
  buildLayeredDesignFlatImageHeuristicCandidateSpecs,
  type LayeredDesignFlatImageHeuristicCandidateSpec,
  type LayeredDesignFlatImageHeuristicCropRect,
} from "./flatImageHeuristics";
import {
  LAYERED_DESIGN_BUILT_IN_PROVIDER_CAPABILITIES,
  type LayeredDesignAnalyzerProviderCapability,
} from "./providerCapabilities";
import type {
  LayeredDesignFlatImageStructuredAnalyzerProvider,
  LayeredDesignFlatImageStructuredAnalyzerProviderInput,
  LayeredDesignFlatImageStructuredImageCandidate,
  LayeredDesignFlatImageStructuredTextCandidate,
} from "./analyzer";

export interface LayeredDesignWorkerHeuristicRasterizer {
  cropImageToPngDataUrl: (
    rect: LayeredDesignFlatImageHeuristicCropRect,
  ) => Promise<string>;
  cropImageWithRefinedSubjectMaskToPngDataUrl?: (
    rect: LayeredDesignFlatImageHeuristicCropRect,
  ) => Promise<string>;
  cropImageWithEllipseMaskToPngDataUrl: (
    rect: LayeredDesignFlatImageHeuristicCropRect,
  ) => Promise<string>;
  createRefinedSubjectMaskDataUrl?: (
    rect: LayeredDesignFlatImageHeuristicCropRect,
  ) => Promise<string>;
  createEllipseMaskDataUrl: (size: {
    width: number;
    height: number;
  }) => Promise<string>;
  createRefinedCleanPlateDataUrl?: (
    rect: LayeredDesignFlatImageHeuristicCropRect,
  ) => Promise<string>;
  createApproximateCleanPlateDataUrl: (
    rect: LayeredDesignFlatImageHeuristicCropRect,
  ) => Promise<string>;
  close?: () => void;
}

export interface LayeredDesignWorkerHeuristicRasterizerFactoryInput {
  image: LayeredDesignFlatImageStructuredAnalyzerProviderInput["image"];
}

export type LayeredDesignWorkerHeuristicRasterizerFactory = (
  input: LayeredDesignWorkerHeuristicRasterizerFactoryInput,
) => Promise<LayeredDesignWorkerHeuristicRasterizer>;

export interface CreateLayeredDesignWorkerHeuristicStructuredAnalyzerProviderOptions {
  rasterizerFactory?: LayeredDesignWorkerHeuristicRasterizerFactory;
  subjectMaskRefiner?: LayeredDesignWorkerHeuristicSubjectMaskRefiner;
  cleanPlateRefiner?: LayeredDesignWorkerHeuristicCleanPlateRefiner;
  textCandidateExtractor?: LayeredDesignWorkerHeuristicTextCandidateExtractor;
  logoCandidateRefiner?: LayeredDesignWorkerHeuristicLogoCandidateRefiner;
  backgroundFragmentRefiner?: LayeredDesignWorkerHeuristicBackgroundFragmentRefiner;
  providerCapabilities?: LayeredDesignAnalyzerProviderCapability[];
}

export interface LayeredDesignWorkerHeuristicSubjectMaskResult {
  imageSrc: string;
  maskSrc: string;
  rect?: LayeredDesignFlatImageHeuristicCropRect;
  confidence?: number;
  hasAlpha?: boolean;
  params?: Record<string, unknown>;
}

export interface LayeredDesignWorkerHeuristicSubjectMaskRefinerInput {
  image: LayeredDesignFlatImageStructuredAnalyzerProviderInput["image"];
  createdAt: string;
  candidate: {
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
  };
}

export type LayeredDesignWorkerHeuristicSubjectMaskRefiner = (
  input: LayeredDesignWorkerHeuristicSubjectMaskRefinerInput,
) => Promise<LayeredDesignWorkerHeuristicSubjectMaskResult | null>;

export interface LayeredDesignWorkerHeuristicCleanPlateResult {
  src: string;
  message?: string;
  params?: Record<string, unknown>;
}

export interface LayeredDesignWorkerHeuristicCleanPlateRefinerInput {
  image: LayeredDesignFlatImageStructuredAnalyzerProviderInput["image"];
  createdAt: string;
  subject: {
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
  };
}

export type LayeredDesignWorkerHeuristicCleanPlateRefiner = (
  input: LayeredDesignWorkerHeuristicCleanPlateRefinerInput,
) => Promise<LayeredDesignWorkerHeuristicCleanPlateResult | null>;

export interface LayeredDesignWorkerHeuristicTextCandidateResult {
  text: string;
  rect?: LayeredDesignFlatImageHeuristicCropRect;
  confidence?: number;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  align?: LayeredDesignFlatImageStructuredTextCandidate["align"];
  lineHeight?: number;
  letterSpacing?: number;
  params?: Record<string, unknown>;
}

export type LayeredDesignWorkerHeuristicTextCandidateExtractorResult =
  | LayeredDesignWorkerHeuristicTextCandidateResult
  | LayeredDesignWorkerHeuristicTextCandidateResult[]
  | null;

export interface LayeredDesignWorkerHeuristicTextCandidateExtractorInput {
  image: LayeredDesignFlatImageStructuredAnalyzerProviderInput["image"];
  createdAt: string;
  candidate: {
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
  };
}

export type LayeredDesignWorkerHeuristicTextCandidateExtractor = (
  input: LayeredDesignWorkerHeuristicTextCandidateExtractorInput,
) => Promise<LayeredDesignWorkerHeuristicTextCandidateExtractorResult>;

export interface LayeredDesignWorkerHeuristicLogoCandidateResult {
  imageSrc: string;
  maskSrc?: string;
  rect?: LayeredDesignFlatImageHeuristicCropRect;
  confidence?: number;
  hasAlpha?: boolean;
}

export interface LayeredDesignWorkerHeuristicLogoCandidateRefinerInput {
  image: LayeredDesignFlatImageStructuredAnalyzerProviderInput["image"];
  createdAt: string;
  candidate: {
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
  };
}

export type LayeredDesignWorkerHeuristicLogoCandidateRefiner = (
  input: LayeredDesignWorkerHeuristicLogoCandidateRefinerInput,
) => Promise<LayeredDesignWorkerHeuristicLogoCandidateResult | null>;

export interface LayeredDesignWorkerHeuristicBackgroundFragmentResult {
  imageSrc: string;
  maskSrc?: string;
  rect?: LayeredDesignFlatImageHeuristicCropRect;
  confidence?: number;
  hasAlpha?: boolean;
}

export interface LayeredDesignWorkerHeuristicBackgroundFragmentRefinerInput {
  image: LayeredDesignFlatImageStructuredAnalyzerProviderInput["image"];
  createdAt: string;
  candidate: {
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
  };
}

export type LayeredDesignWorkerHeuristicBackgroundFragmentRefiner = (
  input: LayeredDesignWorkerHeuristicBackgroundFragmentRefinerInput,
) => Promise<LayeredDesignWorkerHeuristicBackgroundFragmentResult | null>;

type WorkerCanvas2DContext = OffscreenCanvasRenderingContext2D;

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

function findBuiltInProviderCapability(
  modelId: string,
): LayeredDesignAnalyzerProviderCapability | null {
  return (
    LAYERED_DESIGN_BUILT_IN_PROVIDER_CAPABILITIES.find(
      (capability) => capability.modelId === modelId,
    ) ?? null
  );
}

function collectWorkerHeuristicProviderCapabilities(params: {
  options: CreateLayeredDesignWorkerHeuristicStructuredAnalyzerProviderOptions;
  cleanPlateSeed: string;
}): LayeredDesignAnalyzerProviderCapability[] {
  if (params.options.providerCapabilities) {
    return params.options.providerCapabilities;
  }

  const capabilities = new Map<
    string,
    LayeredDesignAnalyzerProviderCapability
  >();
  const modelIds = [
    params.options.subjectMaskRefiner ? "simple_subject_matting_v1" : null,
    params.options.textCandidateExtractor
      ? "deterministic_text_ocr_placeholder_v1"
      : null,
    params.cleanPlateSeed === "worker_heuristic_clean_plate_provider"
      ? "simple_neighbor_inpaint_v1"
      : "local_heuristic_clean_plate_fallback_v1",
  ].filter((modelId): modelId is string => Boolean(modelId));

  for (const modelId of modelIds) {
    const capability = findBuiltInProviderCapability(modelId);
    if (capability) {
      capabilities.set(capability.label, capability);
    }
  }

  return [...capabilities.values()];
}

function createWorkerCanvas(size: {
  width: number;
  height: number;
}): OffscreenCanvas {
  if (typeof OffscreenCanvas !== "function") {
    throw new Error("当前 Worker 环境不支持 OffscreenCanvas");
  }

  return new OffscreenCanvas(
    Math.max(1, Math.round(size.width)),
    Math.max(1, Math.round(size.height)),
  );
}

function getWorkerCanvasContext(
  canvas: OffscreenCanvas,
): WorkerCanvas2DContext {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前 Worker 环境不支持 2D Canvas");
  }

  return context;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa !== "function") {
    throw new Error("当前 Worker 环境不支持 base64 编码");
  }

  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }

  return btoa(binary);
}

async function canvasToPngDataUrl(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || "image/png"};base64,${encodeBase64(bytes)}`;
}

async function loadWorkerImageBitmap(src: string): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("当前 Worker 环境不支持 createImageBitmap");
  }

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Worker analyzer 读取图片失败：HTTP ${response.status}`);
  }

  return await createImageBitmap(await response.blob());
}

function createEllipseMaskCanvas(size: {
  width: number;
  height: number;
}): OffscreenCanvas {
  const canvas = createWorkerCanvas(size);
  const context = getWorkerCanvasContext(canvas);
  const width = canvas.width;
  const height = canvas.height;

  context.fillStyle = "#000000";
  context.fillRect(0, 0, width, height);
  context.beginPath();
  context.ellipse(
    width / 2,
    height / 2,
    Math.max(1, width * 0.42),
    Math.max(1, height * 0.46),
    0,
    0,
    Math.PI * 2,
  );
  context.fillStyle = "#ffffff";
  context.fill();

  return canvas;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function ellipsePriorAlpha(
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.max(1, width * 0.42);
  const radiusY = Math.max(1, height * 0.46);
  const dx = (x + 0.5 - centerX) / radiusX;
  const dy = (y + 0.5 - centerY) / radiusY;
  const distance = dx * dx + dy * dy;

  if (distance <= 0.72) {
    return 1;
  }
  if (distance >= 1.18) {
    return 0;
  }

  return (1.18 - distance) / (1.18 - 0.72);
}

function estimateBackgroundColorFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): RgbColor {
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 24));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  const sample = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    red += data[offset] ?? 0;
    green += data[offset + 1] ?? 0;
    blue += data[offset + 2] ?? 0;
    count += 1;
  };

  for (let x = 0; x < width; x += stride) {
    sample(x, 0);
    sample(x, Math.max(0, height - 1));
  }
  for (let y = 0; y < height; y += stride) {
    sample(0, y);
    sample(Math.max(0, width - 1), y);
  }

  return {
    red: red / Math.max(1, count),
    green: green / Math.max(1, count),
    blue: blue / Math.max(1, count),
  };
}

function createRefinedSubjectMaskFromImageData(
  imageData: ImageData,
): ImageData {
  const { width, height, data } = imageData;
  const background = estimateBackgroundColorFromImageData(data, width, height);
  const maskData = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = data[offset] ?? 0;
      const green = data[offset + 1] ?? 0;
      const blue = data[offset + 2] ?? 0;
      const colorDistance = Math.sqrt(
        (red - background.red) ** 2 +
          (green - background.green) ** 2 +
          (blue - background.blue) ** 2,
      );
      const colorAlpha = Math.max(0, Math.min(1, (colorDistance - 18) / 96));
      const priorAlpha = ellipsePriorAlpha(x, y, width, height);
      const alpha = clampByte(
        Math.max(colorAlpha, priorAlpha * 0.56) * priorAlpha * 255,
      );

      maskData[offset] = alpha;
      maskData[offset + 1] = alpha;
      maskData[offset + 2] = alpha;
      maskData[offset + 3] = 255;
    }
  }

  return new ImageData(maskData, width, height);
}

function createRefinedSubjectMaskCanvas(
  cropCanvas: OffscreenCanvas,
): OffscreenCanvas {
  const context = getWorkerCanvasContext(cropCanvas);
  const imageData = context.getImageData(
    0,
    0,
    cropCanvas.width,
    cropCanvas.height,
  );
  const maskImageData = createRefinedSubjectMaskFromImageData(imageData);
  const maskCanvas = createWorkerCanvas({
    width: cropCanvas.width,
    height: cropCanvas.height,
  });
  getWorkerCanvasContext(maskCanvas).putImageData(maskImageData, 0, 0);

  return maskCanvas;
}

function isInsideRect(
  x: number,
  y: number,
  rect: LayeredDesignFlatImageHeuristicCropRect,
): boolean {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

function readPixelColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): RgbColor | null {
  const sampleX = Math.round(x);
  const sampleY = Math.round(y);

  if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) {
    return null;
  }

  const offset = (sampleY * width + sampleX) * 4;

  return {
    red: data[offset] ?? 0,
    green: data[offset + 1] ?? 0,
    blue: data[offset + 2] ?? 0,
  };
}

function sampleBackgroundAroundRect(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rect: LayeredDesignFlatImageHeuristicCropRect,
  localX: number,
  localY: number,
  fallback: RgbColor,
): RgbColor {
  const globalX = rect.x + localX;
  const globalY = rect.y + localY;
  const padding = Math.max(
    2,
    Math.round(Math.min(rect.width, rect.height) / 32),
  );
  const samples = [
    {
      x: rect.x - padding,
      y: globalY,
      weight: 1 / (localX + 1),
    },
    {
      x: rect.x + rect.width - 1 + padding,
      y: globalY,
      weight: 1 / (rect.width - localX),
    },
    {
      x: globalX,
      y: rect.y - padding,
      weight: 1 / (localY + 1),
    },
    {
      x: globalX,
      y: rect.y + rect.height - 1 + padding,
      weight: 1 / (rect.height - localY),
    },
  ];
  let red = 0;
  let green = 0;
  let blue = 0;
  let totalWeight = 0;

  samples.forEach((sample) => {
    if (isInsideRect(sample.x, sample.y, rect)) {
      return;
    }

    const color = readPixelColor(data, width, height, sample.x, sample.y);
    if (!color) {
      return;
    }

    red += color.red * sample.weight;
    green += color.green * sample.weight;
    blue += color.blue * sample.weight;
    totalWeight += sample.weight;
  });

  if (totalWeight <= 0) {
    return fallback;
  }

  return {
    red: red / totalWeight,
    green: green / totalWeight,
    blue: blue / totalWeight,
  };
}

function createRefinedCleanPlateImageData(
  sourceImageData: ImageData,
  rect: LayeredDesignFlatImageHeuristicCropRect,
  subjectMaskImageData: ImageData,
): ImageData {
  const { width, height, data } = sourceImageData;
  const outputData = new Uint8ClampedArray(data);
  const fallbackBackground = estimateBackgroundColorFromImageData(
    data,
    width,
    height,
  );
  const rectWidth = Math.min(rect.width, subjectMaskImageData.width);
  const rectHeight = Math.min(rect.height, subjectMaskImageData.height);

  for (let y = 0; y < rectHeight; y += 1) {
    for (let x = 0; x < rectWidth; x += 1) {
      const globalX = rect.x + x;
      const globalY = rect.y + y;

      if (globalX < 0 || globalY < 0 || globalX >= width || globalY >= height) {
        continue;
      }

      const maskOffset = (y * subjectMaskImageData.width + x) * 4;
      const maskAlpha = (subjectMaskImageData.data[maskOffset] ?? 0) / 255;
      if (maskAlpha <= 0.02) {
        continue;
      }

      const replacement = sampleBackgroundAroundRect(
        data,
        width,
        height,
        rect,
        x,
        y,
        fallbackBackground,
      );
      const outputOffset = (globalY * width + globalX) * 4;
      const replaceRatio = Math.max(0, Math.min(1, (maskAlpha - 0.08) / 0.72));

      outputData[outputOffset] = clampByte(
        (outputData[outputOffset] ?? 0) * (1 - replaceRatio) +
          replacement.red * replaceRatio,
      );
      outputData[outputOffset + 1] = clampByte(
        (outputData[outputOffset + 1] ?? 0) * (1 - replaceRatio) +
          replacement.green * replaceRatio,
      );
      outputData[outputOffset + 2] = clampByte(
        (outputData[outputOffset + 2] ?? 0) * (1 - replaceRatio) +
          replacement.blue * replaceRatio,
      );
      outputData[outputOffset + 3] = data[outputOffset + 3] ?? 255;
    }
  }

  return new ImageData(outputData, width, height);
}

function readApproximateBackgroundFill(context: WorkerCanvas2DContext): string {
  try {
    const width = context.canvas.width;
    const height = context.canvas.height;
    const samples = [
      context.getImageData(0, 0, 1, 1).data,
      context.getImageData(Math.max(0, width - 1), 0, 1, 1).data,
      context.getImageData(0, Math.max(0, height - 1), 1, 1).data,
      context.getImageData(
        Math.max(0, width - 1),
        Math.max(0, height - 1),
        1,
        1,
      ).data,
    ];
    const channel = (index: number) =>
      Math.round(
        samples.reduce((sum, sample) => sum + (sample[index] ?? 0), 0) /
          Math.max(1, samples.length),
      );

    return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, 0.98)`;
  } catch {
    return "rgba(244, 244, 245, 0.98)";
  }
}

async function createWorkerSubjectCandidateFromRefiner(params: {
  subjectMaskRefiner:
    | LayeredDesignWorkerHeuristicSubjectMaskRefiner
    | undefined;
  input: LayeredDesignFlatImageStructuredAnalyzerProviderInput;
  spec: LayeredDesignFlatImageHeuristicCandidateSpec;
  cropSrc: string;
}): Promise<LayeredDesignFlatImageStructuredImageCandidate | null> {
  const { subjectMaskRefiner, input, spec, cropSrc } = params;
  if (!subjectMaskRefiner || spec.role !== "subject") {
    return null;
  }

  try {
    const result = await subjectMaskRefiner({
      image: input.image,
      createdAt: input.createdAt,
      candidate: {
        id: `${spec.id}-candidate`,
        name: spec.name,
        rect: spec.rect,
        confidence: spec.confidence,
        zIndex: spec.zIndex,
        crop: {
          src: cropSrc,
          width: spec.rect.width,
          height: spec.rect.height,
          mimeType: "image/png",
        },
      },
    });
    if (!result?.imageSrc.trim() || !result.maskSrc.trim()) {
      return null;
    }

    const rect = result.rect ?? spec.rect;
    return {
      id: `${spec.id}-candidate`,
      type: "image",
      role: "subject",
      name: spec.name,
      confidence: result.confidence ?? spec.confidence,
      rect,
      zIndex: spec.zIndex,
      image: {
        id: `${spec.id}-asset`,
        kind: "subject",
        src: result.imageSrc,
        width: rect.width,
        height: rect.height,
        hasAlpha: result.hasAlpha ?? true,
        createdAt: input.createdAt,
        params: {
          seed: "worker_heuristic_subject_matted",
          inputMimeType: input.image.mimeType ?? "image/*",
          outputMimeType: "image/png",
          sourceRect: { ...spec.rect },
          ...(result.params ?? {}),
        },
      },
      mask: {
        id: `${spec.id}-mask`,
        kind: "mask",
        src: result.maskSrc,
        width: rect.width,
        height: rect.height,
        hasAlpha: false,
        createdAt: input.createdAt,
        params: {
          seed: "worker_heuristic_subject_matte_mask",
        },
      },
    };
  } catch {
    return null;
  }
}

async function createWorkerCleanPlateFromRefiner(params: {
  cleanPlateRefiner: LayeredDesignWorkerHeuristicCleanPlateRefiner | undefined;
  rasterizer: LayeredDesignWorkerHeuristicRasterizer;
  input: LayeredDesignFlatImageStructuredAnalyzerProviderInput;
  subjectSpec: LayeredDesignFlatImageHeuristicCandidateSpec | undefined;
  subjectMaskSrc?: string;
}): Promise<LayeredDesignWorkerHeuristicCleanPlateResult | null> {
  const { cleanPlateRefiner, rasterizer, input, subjectSpec } = params;
  if (!cleanPlateRefiner || !subjectSpec) {
    return null;
  }

  try {
    const cropSrc = await rasterizer.cropImageToPngDataUrl(subjectSpec.rect);
    const maskSrc =
      params.subjectMaskSrc ??
      (await (
        rasterizer.createRefinedSubjectMaskDataUrl ??
        ((rect: LayeredDesignFlatImageHeuristicCropRect) =>
          rasterizer.createEllipseMaskDataUrl({
            width: rect.width,
            height: rect.height,
          }))
      )(subjectSpec.rect));
    const result = await cleanPlateRefiner({
      image: input.image,
      createdAt: input.createdAt,
      subject: {
        id: `${subjectSpec.id}-candidate`,
        name: subjectSpec.name,
        rect: subjectSpec.rect,
        confidence: subjectSpec.confidence,
        zIndex: subjectSpec.zIndex,
        crop: {
          src: cropSrc,
          width: subjectSpec.rect.width,
          height: subjectSpec.rect.height,
          mimeType: "image/png",
        },
        maskSrc,
      },
    });
    const src = result?.src.trim();
    if (!result || !src) {
      return null;
    }

    return {
      src,
      ...(result.message ? { message: result.message } : {}),
      ...(result.params ? { params: { ...result.params } } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeWorkerTextCandidateExtractorResult(
  result: LayeredDesignWorkerHeuristicTextCandidateExtractorResult,
): LayeredDesignWorkerHeuristicTextCandidateResult[] {
  if (!result) {
    return [];
  }

  const results = Array.isArray(result) ? result : [result];
  return results.filter((item) => item.text.trim().length > 0);
}

function createWorkerTextCandidateParams(
  result: LayeredDesignWorkerHeuristicTextCandidateResult,
  options: {
    sourceCandidateId: string;
    blockCount: number;
    blockIndex: number;
  },
): Record<string, unknown> | undefined {
  if (options.blockCount === 1) {
    return result.params ? { ...result.params } : undefined;
  }

  return {
    ...(result.params ?? {}),
    ocrSourceCandidateId: options.sourceCandidateId,
    ocrBlockIndex: options.blockIndex,
    ocrBlockCount: options.blockCount,
  };
}

async function createWorkerTextCandidatesFromExtractor(params: {
  textCandidateExtractor:
    | LayeredDesignWorkerHeuristicTextCandidateExtractor
    | undefined;
  input: LayeredDesignFlatImageStructuredAnalyzerProviderInput;
  spec: LayeredDesignFlatImageHeuristicCandidateSpec;
  cropSrc: string;
}): Promise<LayeredDesignFlatImageStructuredTextCandidate[] | null> {
  const { textCandidateExtractor, input, spec, cropSrc } = params;
  if (!textCandidateExtractor || spec.role !== "text") {
    return null;
  }

  try {
    const result = await textCandidateExtractor({
      image: input.image,
      createdAt: input.createdAt,
      candidate: {
        id: `${spec.id}-candidate`,
        name: spec.name,
        rect: spec.rect,
        confidence: spec.confidence,
        zIndex: spec.zIndex,
        crop: {
          src: cropSrc,
          width: spec.rect.width,
          height: spec.rect.height,
          mimeType: "image/png",
        },
      },
    });
    const results = normalizeWorkerTextCandidateExtractorResult(result);
    if (results.length === 0) {
      return null;
    }

    return results.map((item, index) => {
      const sourceCandidateId = `${spec.id}-candidate`;
      const itemParams = createWorkerTextCandidateParams(item, {
        sourceCandidateId,
        blockCount: results.length,
        blockIndex: index,
      });

      return {
        id:
          results.length === 1
            ? sourceCandidateId
            : `${sourceCandidateId}-text-${index + 1}`,
        type: "text",
        role: "text",
        name: results.length === 1 ? spec.name : `${spec.name} ${index + 1}`,
        confidence: item.confidence ?? spec.confidence,
        rect: item.rect ?? spec.rect,
        zIndex: spec.zIndex + index,
        text: item.text.trim(),
        ...(item.fontFamily ? { fontFamily: item.fontFamily } : {}),
        ...(item.fontSize ? { fontSize: item.fontSize } : {}),
        ...(item.color ? { color: item.color } : {}),
        ...(item.align ? { align: item.align } : {}),
        ...(item.lineHeight ? { lineHeight: item.lineHeight } : {}),
        ...(item.letterSpacing ? { letterSpacing: item.letterSpacing } : {}),
        ...(itemParams ? { params: itemParams } : {}),
      };
    });
  } catch {
    return null;
  }
}

async function createWorkerLogoCandidateFromRefiner(params: {
  logoCandidateRefiner:
    | LayeredDesignWorkerHeuristicLogoCandidateRefiner
    | undefined;
  input: LayeredDesignFlatImageStructuredAnalyzerProviderInput;
  spec: LayeredDesignFlatImageHeuristicCandidateSpec;
  cropSrc: string;
}): Promise<LayeredDesignFlatImageStructuredImageCandidate | null> {
  const { logoCandidateRefiner, input, spec, cropSrc } = params;
  if (!logoCandidateRefiner || spec.role !== "logo") {
    return null;
  }

  try {
    const result = await logoCandidateRefiner({
      image: input.image,
      createdAt: input.createdAt,
      candidate: {
        id: `${spec.id}-candidate`,
        name: spec.name,
        rect: spec.rect,
        confidence: spec.confidence,
        zIndex: spec.zIndex,
        crop: {
          src: cropSrc,
          width: spec.rect.width,
          height: spec.rect.height,
          mimeType: "image/png",
        },
      },
    });
    if (!result?.imageSrc.trim()) {
      return null;
    }

    const rect = result.rect ?? spec.rect;
    return {
      id: `${spec.id}-candidate`,
      type: "image",
      role: "logo",
      name: spec.name,
      confidence: result.confidence ?? spec.confidence,
      rect,
      zIndex: spec.zIndex,
      image: {
        id: `${spec.id}-asset`,
        kind: "logo",
        src: result.imageSrc,
        width: rect.width,
        height: rect.height,
        hasAlpha: result.hasAlpha ?? Boolean(result.maskSrc),
        createdAt: input.createdAt,
        params: {
          seed: "worker_heuristic_logo_refined",
          inputMimeType: input.image.mimeType ?? "image/*",
          outputMimeType: "image/png",
          sourceRect: { ...spec.rect },
        },
      },
      ...(result.maskSrc
        ? {
            mask: {
              id: `${spec.id}-mask`,
              kind: "mask" as const,
              src: result.maskSrc,
              width: rect.width,
              height: rect.height,
              hasAlpha: false,
              createdAt: input.createdAt,
              params: {
                seed: "worker_heuristic_logo_refined_mask",
              },
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

async function createWorkerBackgroundFragmentCandidateFromRefiner(params: {
  backgroundFragmentRefiner:
    | LayeredDesignWorkerHeuristicBackgroundFragmentRefiner
    | undefined;
  input: LayeredDesignFlatImageStructuredAnalyzerProviderInput;
  spec: LayeredDesignFlatImageHeuristicCandidateSpec;
  cropSrc: string;
}): Promise<LayeredDesignFlatImageStructuredImageCandidate | null> {
  const { backgroundFragmentRefiner, input, spec, cropSrc } = params;
  if (!backgroundFragmentRefiner || spec.role !== "background_fragment") {
    return null;
  }

  try {
    const result = await backgroundFragmentRefiner({
      image: input.image,
      createdAt: input.createdAt,
      candidate: {
        id: `${spec.id}-candidate`,
        name: spec.name,
        rect: spec.rect,
        confidence: spec.confidence,
        zIndex: spec.zIndex,
        crop: {
          src: cropSrc,
          width: spec.rect.width,
          height: spec.rect.height,
          mimeType: "image/png",
        },
      },
    });
    if (!result?.imageSrc.trim()) {
      return null;
    }

    const rect = result.rect ?? spec.rect;
    return {
      id: `${spec.id}-candidate`,
      type: "image",
      role: "background_fragment",
      name: spec.name,
      confidence: result.confidence ?? spec.confidence,
      rect,
      zIndex: spec.zIndex,
      image: {
        id: `${spec.id}-asset`,
        kind: "effect",
        src: result.imageSrc,
        width: rect.width,
        height: rect.height,
        hasAlpha: result.hasAlpha ?? Boolean(result.maskSrc),
        createdAt: input.createdAt,
        params: {
          seed: "worker_heuristic_background_fragment_refined",
          inputMimeType: input.image.mimeType ?? "image/*",
          outputMimeType: "image/png",
          sourceRect: { ...spec.rect },
        },
      },
      ...(result.maskSrc
        ? {
            mask: {
              id: `${spec.id}-mask`,
              kind: "mask" as const,
              src: result.maskSrc,
              width: rect.width,
              height: rect.height,
              hasAlpha: false,
              createdAt: input.createdAt,
              params: {
                seed: "worker_heuristic_background_fragment_refined_mask",
              },
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

function createDefaultWorkerHeuristicRasterizer(
  image: ImageBitmap,
): LayeredDesignWorkerHeuristicRasterizer {
  const drawCropToCanvas = (rect: LayeredDesignFlatImageHeuristicCropRect) => {
    const canvas = createWorkerCanvas(rect);
    const context = getWorkerCanvasContext(canvas);
    context.drawImage(
      image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    return canvas;
  };

  return {
    cropImageToPngDataUrl: async (rect) => {
      return await canvasToPngDataUrl(drawCropToCanvas(rect));
    },
    cropImageWithRefinedSubjectMaskToPngDataUrl: async (rect) => {
      const canvas = drawCropToCanvas(rect);
      const context = getWorkerCanvasContext(canvas);
      context.globalCompositeOperation = "destination-in";
      context.drawImage(createRefinedSubjectMaskCanvas(canvas), 0, 0);
      context.globalCompositeOperation = "source-over";
      return await canvasToPngDataUrl(canvas);
    },
    cropImageWithEllipseMaskToPngDataUrl: async (rect) => {
      const canvas = drawCropToCanvas(rect);
      const context = getWorkerCanvasContext(canvas);
      const maskCanvas = createEllipseMaskCanvas(rect);
      context.globalCompositeOperation = "destination-in";
      context.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "source-over";
      return await canvasToPngDataUrl(canvas);
    },
    createRefinedSubjectMaskDataUrl: async (rect) =>
      await canvasToPngDataUrl(
        createRefinedSubjectMaskCanvas(drawCropToCanvas(rect)),
      ),
    createEllipseMaskDataUrl: async (size) =>
      await canvasToPngDataUrl(createEllipseMaskCanvas(size)),
    createRefinedCleanPlateDataUrl: async (rect) => {
      const sourceCanvas = createWorkerCanvas({
        width: image.width,
        height: image.height,
      });
      const sourceContext = getWorkerCanvasContext(sourceCanvas);
      sourceContext.drawImage(
        image,
        0,
        0,
        sourceCanvas.width,
        sourceCanvas.height,
      );

      const subjectMaskImageData = createRefinedSubjectMaskFromImageData(
        getWorkerCanvasContext(drawCropToCanvas(rect)).getImageData(
          0,
          0,
          rect.width,
          rect.height,
        ),
      );
      const cleanPlateImageData = createRefinedCleanPlateImageData(
        sourceContext.getImageData(
          0,
          0,
          sourceCanvas.width,
          sourceCanvas.height,
        ),
        rect,
        subjectMaskImageData,
      );
      sourceContext.putImageData(cleanPlateImageData, 0, 0);

      return await canvasToPngDataUrl(sourceCanvas);
    },
    createApproximateCleanPlateDataUrl: async (rect) => {
      const sourceCanvas = createWorkerCanvas({
        width: image.width,
        height: image.height,
      });
      const sourceContext = getWorkerCanvasContext(sourceCanvas);
      sourceContext.drawImage(
        image,
        0,
        0,
        sourceCanvas.width,
        sourceCanvas.height,
      );

      const overlayCanvas = createWorkerCanvas({
        width: sourceCanvas.width,
        height: sourceCanvas.height,
      });
      const overlayContext = getWorkerCanvasContext(overlayCanvas);
      overlayContext.fillStyle = readApproximateBackgroundFill(sourceContext);
      overlayContext.fillRect(rect.x, rect.y, rect.width, rect.height);
      overlayContext.globalCompositeOperation = "destination-in";
      overlayContext.drawImage(
        createEllipseMaskCanvas(rect),
        rect.x,
        rect.y,
        rect.width,
        rect.height,
      );
      overlayContext.globalCompositeOperation = "source-over";
      sourceContext.drawImage(overlayCanvas, 0, 0);

      return await canvasToPngDataUrl(sourceCanvas);
    },
    close: () => image.close(),
  };
}

const defaultRasterizerFactory: LayeredDesignWorkerHeuristicRasterizerFactory =
  async (input) =>
    createDefaultWorkerHeuristicRasterizer(
      await loadWorkerImageBitmap(input.image.src),
    );

export function createLayeredDesignWorkerHeuristicStructuredAnalyzerProvider(
  options: CreateLayeredDesignWorkerHeuristicStructuredAnalyzerProviderOptions = {},
): LayeredDesignFlatImageStructuredAnalyzerProvider {
  const rasterizerFactory =
    options.rasterizerFactory ?? defaultRasterizerFactory;
  const subjectMaskRefiner = options.subjectMaskRefiner;
  const cleanPlateRefiner = options.cleanPlateRefiner;
  const textCandidateExtractor = options.textCandidateExtractor;
  const logoCandidateRefiner = options.logoCandidateRefiner;
  const backgroundFragmentRefiner = options.backgroundFragmentRefiner;

  return {
    analyze: async (input) => {
      const rasterizer = await rasterizerFactory({ image: input.image });
      const specs = buildLayeredDesignFlatImageHeuristicCandidateSpecs(
        input.image.width,
        input.image.height,
      );
      const subjectSpec = specs.find((spec) => spec.role === "subject");

      try {
        const candidateGroups = await Promise.all(
          specs.map(async (spec) => {
            const isSubject = spec.id === subjectSpec?.id;
            if (isSubject && subjectMaskRefiner) {
              const subjectCropSrc = await rasterizer.cropImageToPngDataUrl(
                spec.rect,
              );
              const subjectCandidate =
                await createWorkerSubjectCandidateFromRefiner({
                  subjectMaskRefiner,
                  input,
                  spec,
                  cropSrc: subjectCropSrc,
                });

              if (subjectCandidate) {
                return [subjectCandidate];
              }
            }

            const src = isSubject
              ? await (
                  rasterizer.cropImageWithRefinedSubjectMaskToPngDataUrl ??
                  rasterizer.cropImageWithEllipseMaskToPngDataUrl
                )(spec.rect)
              : await rasterizer.cropImageToPngDataUrl(spec.rect);
            const maskSrc = isSubject
              ? await (
                  rasterizer.createRefinedSubjectMaskDataUrl ??
                  ((rect: LayeredDesignFlatImageHeuristicCropRect) =>
                    rasterizer.createEllipseMaskDataUrl({
                      width: rect.width,
                      height: rect.height,
                    }))
                )(spec.rect)
              : null;
            const textCandidates =
              await createWorkerTextCandidatesFromExtractor({
                textCandidateExtractor,
                input,
                spec,
                cropSrc: src,
              });

            if (textCandidates) {
              return textCandidates;
            }
            const logoCandidate = await createWorkerLogoCandidateFromRefiner({
              logoCandidateRefiner,
              input,
              spec,
              cropSrc: src,
            });

            if (logoCandidate) {
              return [logoCandidate];
            }
            const backgroundFragmentCandidate =
              await createWorkerBackgroundFragmentCandidateFromRefiner({
                backgroundFragmentRefiner,
                input,
                spec,
                cropSrc: src,
              });

            if (backgroundFragmentCandidate) {
              return [backgroundFragmentCandidate];
            }

            return [
              {
                id: `${spec.id}-candidate`,
                type: "image" as const,
                role: spec.role,
                name: spec.name,
                confidence: spec.confidence,
                rect: spec.rect,
                zIndex: spec.zIndex,
                image: {
                  id: `${spec.id}-asset`,
                  kind: spec.kind,
                  src,
                  width: spec.rect.width,
                  height: spec.rect.height,
                  hasAlpha: isSubject ? true : input.image.hasAlpha,
                  createdAt: input.createdAt,
                  params: {
                    seed: isSubject
                      ? "worker_heuristic_subject_refined_masked"
                      : "worker_heuristic_crop",
                    inputMimeType: input.image.mimeType ?? "image/*",
                    outputMimeType: "image/png",
                    sourceRect: { ...spec.rect },
                  },
                },
                ...(isSubject
                  ? {
                      mask: {
                        id: `${spec.id}-mask`,
                        kind: "mask" as const,
                        src: maskSrc ?? "",
                        width: spec.rect.width,
                        height: spec.rect.height,
                        hasAlpha: false,
                        createdAt: input.createdAt,
                        params: {
                          seed: "worker_heuristic_subject_refined_mask",
                        },
                      },
                    }
                  : {}),
              },
            ];
          }),
        );
        const candidates = candidateGroups.flat();
        const subjectImageCandidate = candidates.find(
          (
            candidate,
          ): candidate is LayeredDesignFlatImageStructuredImageCandidate =>
            candidate.type === "image" && candidate.role === "subject",
        );
        const subjectMaskSrc = subjectImageCandidate?.mask?.src;
        const refinedCleanPlate = await createWorkerCleanPlateFromRefiner({
          cleanPlateRefiner,
          rasterizer,
          input,
          subjectSpec,
          subjectMaskSrc,
        });
        const fallbackCleanPlateAsset =
          !refinedCleanPlate &&
          subjectSpec &&
          (await (
            rasterizer.createRefinedCleanPlateDataUrl ??
            rasterizer.createApproximateCleanPlateDataUrl
          )(subjectSpec.rect));
        const cleanPlateAsset = refinedCleanPlate?.src ?? fallbackCleanPlateAsset;
        const cleanPlateSeed = refinedCleanPlate
          ? "worker_heuristic_clean_plate_provider"
          : rasterizer.createRefinedCleanPlateDataUrl
            ? "worker_heuristic_refined_clean_plate"
            : "worker_heuristic_clean_plate";

        return {
          analyzer: {
            kind: "local_heuristic",
            label: "Worker local heuristic analyzer",
          },
          providerCapabilities: collectWorkerHeuristicProviderCapabilities({
            options,
            cleanPlateSeed,
          }),
          generatedAt: input.createdAt,
          candidates,
          cleanPlate: cleanPlateAsset
            ? {
                asset: {
                  id: "worker-heuristic-clean-plate-asset",
                  kind: "clean_plate",
                  src: cleanPlateAsset,
                  width: input.image.width,
                  height: input.image.height,
                  hasAlpha: false,
                  createdAt: input.createdAt,
                  params: {
                    seed: cleanPlateSeed,
                    ...(refinedCleanPlate?.params ?? {}),
                  },
                },
                message:
                  refinedCleanPlate?.message ??
                  "当前 clean plate 来自 Worker local heuristic 近似修补，不是真 inpaint；进入编辑后仍需人工核对主体移动边缘。",
              }
            : {
                status: "not_requested",
                message: "Worker local heuristic 未找到主体候选。",
              },
        };
      } finally {
        rasterizer.close?.();
      }
    },
  };
}
