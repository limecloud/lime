import {
  analyzeLayeredDesignFlatImageNative,
  recognizeLayeredDesignText,
  type AnalyzeLayeredDesignFlatImageNativeOutput,
  type RecognizeLayeredDesignTextOutput,
} from "@/lib/api/layeredDesignAnalysis";
import { createLayeredDesignFlatImageHeuristicSeed } from "./flatImageHeuristics";
import {
  chooseLayeredDesignProviderCapability,
  createLayeredDesignProviderCapabilityRegistry,
  type LayeredDesignAnalyzerProviderCapability,
} from "./providerCapabilities";
import { detectTextWithLayeredDesignPrioritizedTextOcrProviders } from "./textOcr";
import type {
  GeneratedDesignAsset,
  GeneratedDesignAssetKind,
  LayeredDesignExtractionAnalysisInput,
  LayeredDesignExtractionAnalyzerInfo,
  LayeredDesignExtractionAnalyzerInfoInput,
  LayeredDesignExtractionAnalyzerKind,
  LayeredDesignExtractionCandidateInput,
  LayeredDesignExtractionCandidateIssue,
  LayeredDesignExtractionCandidateRole,
  LayeredDesignExtractionCleanPlateInput,
  LayeredDesignExtractionCleanPlateStatus,
  Rect,
  TextLayer,
} from "./types";

export type LayeredDesignFlatImageAnalyzerKind =
  LayeredDesignExtractionAnalyzerKind;
export type LayeredDesignFlatImageAnalyzerInfo =
  LayeredDesignExtractionAnalyzerInfo;

export interface AnalyzeLayeredDesignFlatImageParams {
  image: {
    src: string;
    width: number;
    height: number;
    mimeType?: string;
    hasAlpha?: boolean;
  };
  structuredAnalyzerProvider?:
    | LayeredDesignFlatImageStructuredAnalyzerProvider
    | null;
  textOcrProvider?: LayeredDesignFlatImageTextOcrProvider | null;
  createdAt?: string;
}

export interface LayeredDesignFlatImageAnalysisResult {
  analysis: LayeredDesignExtractionAnalysisInput;
  candidates: LayeredDesignExtractionCandidateInput[];
  cleanPlate: LayeredDesignExtractionCleanPlateInput;
}

export type AnalyzeLayeredDesignFlatImage = (
  params: AnalyzeLayeredDesignFlatImageParams,
) => Promise<LayeredDesignFlatImageAnalysisResult>;

export interface LayeredDesignFlatImageStructuredAssetInput {
  id?: string;
  kind?: GeneratedDesignAssetKind;
  src: string;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  provider?: string;
  modelId?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  parentAssetId?: string;
  createdAt?: string;
}

interface LayeredDesignFlatImageStructuredCandidateBase {
  id: string;
  role: LayeredDesignExtractionCandidateRole;
  name?: string;
  confidence?: number;
  rect: Rect;
  zIndex?: number;
  selected?: boolean;
  issues?: LayeredDesignExtractionCandidateIssue[];
}

export interface LayeredDesignFlatImageStructuredImageCandidate
  extends LayeredDesignFlatImageStructuredCandidateBase {
  type: "image";
  image: LayeredDesignFlatImageStructuredAssetInput;
  mask?: LayeredDesignFlatImageStructuredAssetInput;
  prompt?: string;
}

export interface LayeredDesignFlatImageStructuredTextCandidate
  extends LayeredDesignFlatImageStructuredCandidateBase {
  type: "text";
  text: string;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  align?: TextLayer["align"];
  lineHeight?: number;
  letterSpacing?: number;
  params?: Record<string, unknown>;
}

export type LayeredDesignFlatImageStructuredCandidate =
  | LayeredDesignFlatImageStructuredImageCandidate
  | LayeredDesignFlatImageStructuredTextCandidate;

export interface LayeredDesignFlatImageStructuredCleanPlateInput {
  status?: LayeredDesignExtractionCleanPlateStatus;
  asset?: LayeredDesignFlatImageStructuredAssetInput;
  assetId?: string;
  message?: string;
}

export interface CreateLayeredDesignFlatImageAnalysisResultFromStructuredResultParams {
  analyzer: LayeredDesignExtractionAnalyzerInfoInput;
  candidates: LayeredDesignFlatImageStructuredCandidate[];
  cleanPlate?: LayeredDesignFlatImageStructuredCleanPlateInput;
  providerCapabilities?: LayeredDesignAnalyzerProviderCapability[];
  generatedAt?: string;
}

export type LayeredDesignFlatImageStructuredAnalyzerResult =
  CreateLayeredDesignFlatImageAnalysisResultFromStructuredResultParams;

export interface LayeredDesignFlatImageStructuredAnalyzerProviderInput {
  image: AnalyzeLayeredDesignFlatImageParams["image"];
  createdAt: string;
  textOcrProvider?: LayeredDesignFlatImageTextOcrProvider | null;
}

export interface LayeredDesignFlatImageStructuredAnalyzerProvider {
  analyze: (
    input: LayeredDesignFlatImageStructuredAnalyzerProviderInput,
  ) => Promise<LayeredDesignFlatImageStructuredAnalyzerResult>;
}

export interface CreateLayeredDesignFlatImageAnalyzerFromStructuredProviderOptions {
  textOcrProvider?: LayeredDesignFlatImageTextOcrProvider | null;
  fallbackAnalyzer?: AnalyzeLayeredDesignFlatImage | null;
}

export interface LayeredDesignFlatImageOcrTextBlock {
  text: string;
  boundingBox?: Pick<Rect, "x" | "y" | "width" | "height">;
  confidence?: number;
  params?: Record<string, unknown>;
}

export interface LayeredDesignFlatImageTextOcrProviderInput {
  image: AnalyzeLayeredDesignFlatImageParams["image"];
  candidate: {
    id: string;
    name: string;
    role: LayeredDesignExtractionCandidateRole;
    rect: Rect;
    asset: GeneratedDesignAsset;
  };
}

export interface LayeredDesignFlatImageTextOcrProvider {
  label: string;
  detectText: (
    input: LayeredDesignFlatImageTextOcrProviderInput,
  ) => Promise<LayeredDesignFlatImageOcrTextBlock[]>;
}

type RecognizeLayeredDesignText = typeof recognizeLayeredDesignText;
type AnalyzeLayeredDesignFlatImageNative =
  typeof analyzeLayeredDesignFlatImageNative;

interface DetectedTextLike {
  rawValue?: string;
  boundingBox?: Pick<Rect, "x" | "y" | "width" | "height">;
}

type TextDetectorInput = HTMLImageElement | HTMLCanvasElement;

interface TextDetectorLike {
  detect(image: TextDetectorInput): Promise<DetectedTextLike[]>;
}

interface TextDetectorConstructorLike {
  new (): TextDetectorLike;
}

const nowIso = (): string => new Date().toISOString();
const providerCapabilityRegistry =
  createLayeredDesignProviderCapabilityRegistry();

const defaultCandidateNameByRole: Record<
  LayeredDesignExtractionCandidateRole,
  string
> = {
  subject: "主体候选",
  logo: "Logo 候选",
  effect: "特效候选",
  text: "文字候选",
  background_fragment: "背景碎片候选",
};

function inferAssetKindFromRole(
  role: LayeredDesignExtractionCandidateRole,
): GeneratedDesignAssetKind {
  switch (role) {
    case "subject":
      return "subject";
    case "logo":
      return "logo";
    case "effect":
    case "background_fragment":
      return "effect";
    case "text":
      return "text_raster";
  }
}

function createGeneratedAssetFromStructuredInput(
  asset: LayeredDesignFlatImageStructuredAssetInput,
  options: {
    defaultId: string;
    defaultKind: GeneratedDesignAssetKind;
    defaultWidth: number;
    defaultHeight: number;
    defaultHasAlpha: boolean;
    createdAt: string;
  },
): GeneratedDesignAsset {
  return {
    id: asset.id?.trim() || options.defaultId,
    kind: asset.kind ?? options.defaultKind,
    src: asset.src,
    width: asset.width ?? options.defaultWidth,
    height: asset.height ?? options.defaultHeight,
    hasAlpha: asset.hasAlpha ?? options.defaultHasAlpha,
    createdAt: asset.createdAt ?? options.createdAt,
    ...(asset.provider ? { provider: asset.provider } : {}),
    ...(asset.modelId ? { modelId: asset.modelId } : {}),
    ...(asset.prompt ? { prompt: asset.prompt } : {}),
    ...(asset.params ? { params: { ...asset.params } } : {}),
    ...(asset.parentAssetId ? { parentAssetId: asset.parentAssetId } : {}),
  };
}

function createImageCandidateInput(
  candidate: LayeredDesignFlatImageStructuredImageCandidate,
  createdAt: string,
): LayeredDesignExtractionCandidateInput {
  const imageAsset = createGeneratedAssetFromStructuredInput(candidate.image, {
    defaultId: `${candidate.id}-asset`,
    defaultKind: inferAssetKindFromRole(candidate.role),
    defaultWidth: candidate.rect.width,
    defaultHeight: candidate.rect.height,
    defaultHasAlpha: Boolean(candidate.mask),
    createdAt,
  });
  const maskAsset = candidate.mask
    ? createGeneratedAssetFromStructuredInput(candidate.mask, {
        defaultId: `${candidate.id}-mask`,
        defaultKind: "mask",
        defaultWidth: candidate.rect.width,
        defaultHeight: candidate.rect.height,
        defaultHasAlpha: false,
        createdAt,
      })
    : undefined;

  return {
    id: candidate.id,
    role: candidate.role,
    confidence: candidate.confidence,
    selected: candidate.selected,
    issues: candidate.issues,
    layer: {
      id: `${candidate.id}-layer`,
      name: candidate.name ?? defaultCandidateNameByRole[candidate.role],
      type: "image",
      assetId: imageAsset.id,
      ...(maskAsset ? { maskAssetId: maskAsset.id } : {}),
      x: candidate.rect.x,
      y: candidate.rect.y,
      width: candidate.rect.width,
      height: candidate.rect.height,
      zIndex: candidate.zIndex ?? 20,
      alphaMode: maskAsset ? "mask" : "embedded",
      source: "extracted",
      ...(candidate.prompt ? { prompt: candidate.prompt } : {}),
    },
    assets: [imageAsset, ...(maskAsset ? [maskAsset] : [])],
  };
}

function createTextCandidateInput(
  candidate: LayeredDesignFlatImageStructuredTextCandidate,
): LayeredDesignExtractionCandidateInput {
  return {
    id: candidate.id,
    role: candidate.role,
    confidence: candidate.confidence,
    selected: candidate.selected,
    issues: candidate.issues,
    layer: {
      id: `${candidate.id}-layer`,
      name: candidate.name ?? defaultCandidateNameByRole[candidate.role],
      type: "text",
      text: candidate.text,
      x: candidate.rect.x,
      y: candidate.rect.y,
      width: candidate.rect.width,
      height: candidate.rect.height,
      zIndex: candidate.zIndex ?? 40,
      fontFamily: candidate.fontFamily,
      fontSize: candidate.fontSize,
      color: candidate.color,
      align: candidate.align,
      lineHeight: candidate.lineHeight,
      letterSpacing: candidate.letterSpacing,
      ...(candidate.params ? { params: { ...candidate.params } } : {}),
      source: "extracted",
    },
  };
}

function createCandidateInput(
  candidate: LayeredDesignFlatImageStructuredCandidate,
  createdAt: string,
): LayeredDesignExtractionCandidateInput {
  return candidate.type === "text"
    ? createTextCandidateInput(candidate)
    : createImageCandidateInput(candidate, createdAt);
}

function createCleanPlateInput(
  cleanPlate: LayeredDesignFlatImageStructuredCleanPlateInput | undefined,
  createdAt: string,
): LayeredDesignExtractionCleanPlateInput {
  if (!cleanPlate) {
    return {
      status: "not_requested",
    };
  }

  const cleanPlateAsset = cleanPlate.asset
    ? createGeneratedAssetFromStructuredInput(cleanPlate.asset, {
        defaultId: "clean-plate-asset",
        defaultKind: "clean_plate",
        defaultWidth: cleanPlate.asset.width ?? 1,
        defaultHeight: cleanPlate.asset.height ?? 1,
        defaultHasAlpha: cleanPlate.asset.hasAlpha ?? false,
        createdAt,
      })
    : undefined;
  const status =
    cleanPlate.status ??
    (cleanPlateAsset || cleanPlate.assetId ? "succeeded" : "not_requested");

  return {
    status,
    ...(cleanPlateAsset ? { asset: cleanPlateAsset } : {}),
    ...(cleanPlate.assetId && !cleanPlateAsset
      ? { assetId: cleanPlate.assetId }
      : {}),
    ...(cleanPlate.message ? { message: cleanPlate.message } : {}),
  };
}

function findAnalyzerProviderCapability(
  capability: Pick<
    LayeredDesignAnalyzerProviderCapability,
    "kind" | "execution" | "modelId"
  >,
): LayeredDesignAnalyzerProviderCapability | null {
  return (
    chooseLayeredDesignProviderCapability(
      providerCapabilityRegistry,
      capability.kind,
      {
        execution: capability.execution,
      },
    ) ??
    providerCapabilityRegistry.capabilities.find(
      (candidate) => candidate.modelId === capability.modelId,
    ) ??
    null
  );
}

function resolveLocalHeuristicProviderCapabilities(params: {
  cleanPlate: {
    status?: LayeredDesignExtractionCleanPlateStatus;
    asset?: unknown;
    assetId?: string;
  };
  textOcrProviderLabel?: string;
}): LayeredDesignAnalyzerProviderCapability[] {
  const capabilities = new Map<
    string,
    LayeredDesignAnalyzerProviderCapability
  >();

  if (
    params.cleanPlate.status === "succeeded" ||
    Boolean(params.cleanPlate.asset) ||
    Boolean(params.cleanPlate.assetId)
  ) {
    const cleanPlateCapability = findAnalyzerProviderCapability({
      kind: "clean_plate",
      execution: "local_heuristic",
      modelId: "local_heuristic_clean_plate_fallback_v1",
    });
    if (cleanPlateCapability) {
      capabilities.set(cleanPlateCapability.label, cleanPlateCapability);
    }
  }

  const textOcrProviderLabel = params.textOcrProviderLabel?.toLowerCase() ?? "";
  if (textOcrProviderLabel.includes("tauri native ocr")) {
    const nativeOcrCapability = findAnalyzerProviderCapability({
      kind: "text_ocr",
      execution: "native_command",
      modelId: "tauri_native_ocr",
    });
    if (nativeOcrCapability) {
      capabilities.set(nativeOcrCapability.label, nativeOcrCapability);
    }
  }
  if (
    textOcrProviderLabel.includes("textdetector") ||
    textOcrProviderLabel.includes("浏览器")
  ) {
    const browserOcrCapability = findAnalyzerProviderCapability({
      kind: "text_ocr",
      execution: "local_heuristic",
      modelId: "browser_text_detector",
    });
    if (browserOcrCapability) {
      capabilities.set(browserOcrCapability.label, browserOcrCapability);
    }
  }

  return [...capabilities.values()];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new window.Image();

  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("本地 analyzer 读取图片失败"));
    image.src = src;
  });
}

function getTextDetectorConstructor(): TextDetectorConstructorLike | null {
  const textDetector = (
    globalThis as typeof globalThis & {
      TextDetector?: TextDetectorConstructorLike;
    }
  ).TextDetector;

  return typeof textDetector === "function" ? textDetector : null;
}

function createCanvas(size: { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(size.width));
  canvas.height = Math.max(1, Math.round(size.height));
  return canvas;
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getCanvasContext(
  canvas: HTMLCanvasElement,
  message: string,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(message);
  }
  return context;
}

function createEllipseMaskCanvas(size: {
  width: number;
  height: number;
}): HTMLCanvasElement {
  const canvas = createCanvas(size);
  const context = getCanvasContext(canvas, "当前环境不支持本地 analyzer mask 生成");
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

function applyMaskToCropImage(
  sourceImage: HTMLImageElement,
  size: { width: number; height: number },
  maskCanvas: HTMLCanvasElement,
): string {
  const canvas = createCanvas(size);
  const context = getCanvasContext(canvas, "当前环境不支持本地 analyzer 主体抠图");

  context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-over";

  return canvas.toDataURL("image/png");
}

function readApproximateBackgroundFill(
  context: CanvasRenderingContext2D,
): string {
  try {
    const samples = [
      context.getImageData(0, 0, 1, 1).data,
      context.getImageData(Math.max(0, context.canvas.width - 1), 0, 1, 1).data,
      context.getImageData(0, Math.max(0, context.canvas.height - 1), 1, 1).data,
      context.getImageData(
        Math.max(0, context.canvas.width - 1),
        Math.max(0, context.canvas.height - 1),
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

function createApproximateCleanPlate(
  sourceImage: HTMLImageElement,
  rect: Rect,
  maskCanvas: HTMLCanvasElement,
): string {
  const sourceCanvas = createCanvas({
    width: sourceImage.naturalWidth || sourceImage.width,
    height: sourceImage.naturalHeight || sourceImage.height,
  });
  const sourceContext = getCanvasContext(
    sourceCanvas,
    "当前环境不支持本地 analyzer clean plate 生成",
  );
  sourceContext.drawImage(
    sourceImage,
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  );

  const overlayCanvas = createCanvas({
    width: sourceCanvas.width,
    height: sourceCanvas.height,
  });
  const overlayContext = getCanvasContext(
    overlayCanvas,
    "当前环境不支持本地 analyzer clean plate 生成",
  );
  overlayContext.fillStyle = readApproximateBackgroundFill(sourceContext);
  overlayContext.fillRect(rect.x, rect.y, rect.width, rect.height);
  overlayContext.globalCompositeOperation = "destination-in";
  overlayContext.drawImage(maskCanvas, rect.x, rect.y, rect.width, rect.height);
  overlayContext.globalCompositeOperation = "source-over";
  sourceContext.drawImage(overlayCanvas, 0, 0);

  return sourceCanvas.toDataURL("image/png");
}

function normalizeDetectedTextRect(
  rect: Pick<Rect, "x" | "y" | "width" | "height"> | undefined,
  fallback: Rect,
): Rect {
  if (!rect) {
    return { ...fallback };
  }

  const width = clamp(
    normalizePositiveInteger(rect.width, fallback.width),
    1,
    fallback.width,
  );
  const height = clamp(
    normalizePositiveInteger(rect.height, fallback.height),
    1,
    fallback.height,
  );
  const x = clamp(Math.round(rect.x), 0, Math.max(0, fallback.width - width));
  const y = clamp(
    Math.round(rect.y),
    0,
    Math.max(0, fallback.height - height),
  );

  return { x, y, width, height };
}

function inferTextLayerFontSize(height: number): number {
  return clamp(Math.round(height * 0.8), 18, 96);
}

function resolveOcrTextBlockConfidence(
  blockConfidence: number | undefined,
  fallbackConfidence: number | undefined,
): number | undefined {
  if (typeof blockConfidence === "number" && Number.isFinite(blockConfidence)) {
    return clamp(blockConfidence, 0, 1);
  }

  return fallbackConfidence;
}

function createDetectedTextCandidateId(
  sourceCandidateId: string,
  blockCount: number,
  blockIndex: number,
): string {
  return blockCount === 1
    ? sourceCandidateId
    : `${sourceCandidateId}-text-${blockIndex + 1}`;
}

function createDetectedTextCandidateName(
  sourceCandidateName: string,
  blockCount: number,
  blockIndex: number,
): string {
  return blockCount === 1
    ? sourceCandidateName
    : `${sourceCandidateName} ${blockIndex + 1}`;
}

function createDetectedTextCandidateParams(
  block: NormalizedOcrTextBlock,
  options: {
    sourceCandidateId: string;
    blockCount: number;
    blockIndex: number;
  },
): Record<string, unknown> | undefined {
  if (options.blockCount === 1) {
    return block.params ? { ...block.params } : undefined;
  }

  return {
    ...(block.params ?? {}),
    ocrSourceCandidateId: options.sourceCandidateId,
    ocrBlockIndex: options.blockIndex,
    ocrBlockCount: options.blockCount,
  };
}

function isImageCandidateInput(
  candidate: LayeredDesignExtractionCandidateInput,
): candidate is LayeredDesignExtractionCandidateInput & {
  layer: {
    type: "image" | "effect";
    assetId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex?: number;
    name: string;
    prompt?: string;
  };
  assets: GeneratedDesignAsset[];
} {
  return (
    (candidate.layer.type === "image" || candidate.layer.type === "effect") &&
    Array.isArray(candidate.assets)
  );
}

function findPrimaryCandidateAsset(
  candidate: LayeredDesignExtractionCandidateInput & {
    layer: { assetId: string };
    assets: GeneratedDesignAsset[];
  },
): GeneratedDesignAsset {
  return (
    candidate.assets.find((asset) => asset.id === candidate.layer.assetId) ??
    candidate.assets[0]
  );
}

async function detectTextCandidateFromImageCandidate(
  params: AnalyzeLayeredDesignFlatImageParams,
  candidate: LayeredDesignExtractionCandidateInput & {
    layer: {
      type: "image" | "effect";
      x: number;
      y: number;
      width: number;
      height: number;
      zIndex?: number;
      name: string;
    };
    assets: GeneratedDesignAsset[];
  },
): Promise<{
  sourceCandidateId: string;
  candidates: LayeredDesignFlatImageStructuredTextCandidate[];
  providerLabel: string;
} | null> {
  const providers = resolveTextOcrProviders(params);
  if (providers.length === 0) {
    return null;
  }

  const asset = findPrimaryCandidateAsset(candidate);
  const fallbackRect: Rect = {
    x: 0,
    y: 0,
    width: candidate.layer.width,
    height: candidate.layer.height,
  };

  try {
    const detection =
      await detectTextWithLayeredDesignPrioritizedTextOcrProviders(providers, {
        image: params.image,
        candidate: {
          id: candidate.id,
          name: candidate.layer.name,
          role: candidate.role,
          rect: {
            x: candidate.layer.x,
            y: candidate.layer.y,
            width: candidate.layer.width,
            height: candidate.layer.height,
          },
          asset,
        },
      });
    if (!detection) {
      return null;
    }

    const normalized = normalizeOcrTextBlocks(detection.blocks, fallbackRect);
    if (normalized.length === 0) {
      return null;
    }

    return {
      sourceCandidateId: candidate.id,
      providerLabel: detection.provider.label,
      candidates: normalized.map((block, index) => {
        const blockParams = createDetectedTextCandidateParams(block, {
          sourceCandidateId: candidate.id,
          blockCount: normalized.length,
          blockIndex: index,
        });

        return {
          id: createDetectedTextCandidateId(
            candidate.id,
            normalized.length,
            index,
          ),
          type: "text",
          role: "text",
          name: createDetectedTextCandidateName(
            candidate.layer.name,
            normalized.length,
            index,
          ),
          confidence: resolveOcrTextBlockConfidence(
            block.confidence,
            candidate.confidence,
          ),
          selected: candidate.selected,
          issues: candidate.issues,
          rect: {
            x: candidate.layer.x + block.rect.x,
            y: candidate.layer.y + block.rect.y,
            width: block.rect.width,
            height: block.rect.height,
          },
          zIndex:
            typeof candidate.layer.zIndex === "number"
              ? candidate.layer.zIndex + index
              : undefined,
          text: block.text,
          fontSize: inferTextLayerFontSize(block.rect.height),
          color: "#111111",
          align: "center",
          lineHeight: 1.1,
          ...(blockParams ? { params: blockParams } : {}),
        };
      }),
    };
  } catch {
    return null;
  }
}

interface NormalizedOcrTextBlock {
  text: string;
  rect: Rect;
  confidence?: number;
  params?: Record<string, unknown>;
}

function normalizeOcrTextBlocks(
  blocks: LayeredDesignFlatImageOcrTextBlock[],
  fallbackRect: Rect,
): NormalizedOcrTextBlock[] {
  return blocks
    .map((block) => {
      const confidence =
        typeof block.confidence === "number" && Number.isFinite(block.confidence)
          ? clamp(block.confidence, 0, 1)
          : undefined;

      return {
        text: block.text.trim(),
        rect: normalizeDetectedTextRect(block.boundingBox, fallbackRect),
        ...(confidence !== undefined ? { confidence } : {}),
        ...(block.params ? { params: { ...block.params } } : {}),
      };
    })
    .filter((item) => item.text.length > 0);
}

export function createLayeredDesignTextDetectorOcrProvider():
  | LayeredDesignFlatImageTextOcrProvider
  | null {
  const TextDetectorConstructor = getTextDetectorConstructor();
  if (!TextDetectorConstructor) {
    return null;
  }

  return {
    label: "浏览器 TextDetector OCR",
    detectText: async (input) => {
      const image = await loadImage(input.candidate.asset.src);
      const detector = new TextDetectorConstructor();
      const detections = await detector.detect(image);

      return (Array.isArray(detections) ? detections : []).map((detection) => ({
        text: detection.rawValue?.trim() ?? "",
        boundingBox: detection.boundingBox,
      }));
    },
  };
}

export function createLayeredDesignNativeTextOcrProvider(
  recognizeText: RecognizeLayeredDesignText = recognizeLayeredDesignText,
): LayeredDesignFlatImageTextOcrProvider {
  return {
    label: "Tauri native OCR",
    detectText: async (input) => {
      const output: RecognizeLayeredDesignTextOutput = await recognizeText({
        imageSrc: input.candidate.asset.src,
        width: input.candidate.asset.width || input.candidate.rect.width,
        height: input.candidate.asset.height || input.candidate.rect.height,
        candidateId: input.candidate.id,
      });

      if (!output.supported) {
        return [];
      }

      return output.blocks.map((block) => ({
        text: block.text,
        boundingBox: block.boundingBox,
        confidence: block.confidence,
      }));
    },
  };
}

export function createLayeredDesignNativeStructuredAnalyzerProvider(
  analyzeNative: AnalyzeLayeredDesignFlatImageNative =
    analyzeLayeredDesignFlatImageNative,
): LayeredDesignFlatImageStructuredAnalyzerProvider {
  return {
    analyze: async (input) => {
      const output: AnalyzeLayeredDesignFlatImageNativeOutput =
        await analyzeNative({
          image: input.image,
          createdAt: input.createdAt,
        });

      if (!output.supported || !output.result) {
        throw new Error(output.message ?? "Tauri native analyzer 不可用");
      }

      return output.result;
    },
  };
}

function resolveTextOcrProviders(
  params: AnalyzeLayeredDesignFlatImageParams,
): LayeredDesignFlatImageTextOcrProvider[] {
  if (params.textOcrProvider === null) {
    return [];
  }

  if (params.textOcrProvider) {
    return [params.textOcrProvider];
  }

  return [
    createLayeredDesignNativeTextOcrProvider(),
    createLayeredDesignTextDetectorOcrProvider(),
  ].filter((provider): provider is LayeredDesignFlatImageTextOcrProvider =>
    Boolean(provider),
  );
}

async function buildLocalHeuristicStructuredResult(
  params: AnalyzeLayeredDesignFlatImageParams,
  seedCandidates: LayeredDesignExtractionCandidateInput[],
  generatedAt: string,
): Promise<{
  candidates: LayeredDesignFlatImageStructuredCandidate[];
  cleanPlate: LayeredDesignFlatImageStructuredCleanPlateInput;
  textOcrProviderLabel?: string;
}> {
  const subjectCandidate = seedCandidates.find(
    (candidate) => candidate.role === "subject" && isImageCandidateInput(candidate),
  );
  const textCandidates = seedCandidates.filter(
    (candidate) => candidate.role === "text" && isImageCandidateInput(candidate),
  );
  const detectedTextCandidates = (
    await Promise.all(
      textCandidates.map((candidate) =>
        isImageCandidateInput(candidate)
          ? detectTextCandidateFromImageCandidate(params, candidate)
          : null,
      ),
    )
  ).filter((candidate): candidate is NonNullable<typeof candidate> =>
    Boolean(candidate),
  );
  const detectedTextCandidateById = new Map(
    detectedTextCandidates.map((candidate) => [
      candidate.sourceCandidateId,
      candidate,
    ]),
  );
  const textOcrProviderLabel = detectedTextCandidates[0]?.providerLabel;

  if (!subjectCandidate || !isImageCandidateInput(subjectCandidate)) {
    return {
      candidates: seedCandidates.flatMap(
        (candidate): LayeredDesignFlatImageStructuredCandidate[] => {
          const detectedTextCandidate = detectedTextCandidateById.get(
            candidate.id,
          );
          if (detectedTextCandidate) {
            return detectedTextCandidate.candidates;
          }

          if (!isImageCandidateInput(candidate)) {
            return [];
          }

          return [
            {
              id: candidate.id,
              type: "image",
              role: candidate.role,
              name: candidate.layer.name,
              confidence: candidate.confidence,
              selected: candidate.selected,
              issues: candidate.issues,
              rect: {
                x: candidate.layer.x,
                y: candidate.layer.y,
                width: candidate.layer.width,
                height: candidate.layer.height,
              },
              zIndex: candidate.layer.zIndex,
              prompt: candidate.layer.prompt,
              image: findPrimaryCandidateAsset(candidate),
            },
          ];
        },
      ),
      cleanPlate: {
        status: "not_requested",
        message: "当前没有可用于本地 heuristic clean plate 的主体候选。",
      },
      ...(textOcrProviderLabel ? { textOcrProviderLabel } : {}),
    };
  }

  try {
    const subjectAsset = findPrimaryCandidateAsset(subjectCandidate);
    const cropImage = await loadImage(subjectAsset.src);
    const sourceImage = await loadImage(params.image.src);
    const maskCanvas = createEllipseMaskCanvas({
      width: subjectCandidate.layer.width,
      height: subjectCandidate.layer.height,
    });
    const maskSrc = maskCanvas.toDataURL("image/png");
    const maskedCropSrc = applyMaskToCropImage(
      cropImage,
      {
        width: subjectCandidate.layer.width,
        height: subjectCandidate.layer.height,
      },
      maskCanvas,
    );
    const cleanPlateSrc = createApproximateCleanPlate(
      sourceImage,
      {
        x: subjectCandidate.layer.x,
        y: subjectCandidate.layer.y,
        width: subjectCandidate.layer.width,
        height: subjectCandidate.layer.height,
      },
      maskCanvas,
    );

    return {
      candidates: seedCandidates.flatMap(
        (candidate): LayeredDesignFlatImageStructuredCandidate[] => {
          const detectedTextCandidate = detectedTextCandidateById.get(
            candidate.id,
          );
          if (detectedTextCandidate) {
            return detectedTextCandidate.candidates;
          }

          if (!isImageCandidateInput(candidate)) {
            return [];
          }

          const asset = findPrimaryCandidateAsset(candidate);
          const isSubject = candidate.id === subjectCandidate.id;

          return [
            {
              id: candidate.id,
              type: "image",
              role: candidate.role,
              name: candidate.layer.name,
              confidence: candidate.confidence,
              selected: candidate.selected,
              issues: candidate.issues,
              rect: {
                x: candidate.layer.x,
                y: candidate.layer.y,
                width: candidate.layer.width,
                height: candidate.layer.height,
              },
              zIndex: candidate.layer.zIndex,
              prompt: candidate.layer.prompt,
              image: {
                ...asset,
                src: isSubject ? maskedCropSrc : asset.src,
                hasAlpha: isSubject ? true : asset.hasAlpha,
                createdAt: generatedAt,
                params: {
                  ...(asset.params ?? {}),
                  ...(isSubject
                    ? { seed: "local_heuristic_subject_masked" }
                    : {}),
                },
              },
              ...(isSubject
                ? {
                    mask: {
                      id: `${candidate.id}-mask`,
                      kind: "mask" as const,
                      src: maskSrc,
                      width: candidate.layer.width,
                      height: candidate.layer.height,
                      hasAlpha: false,
                      createdAt: generatedAt,
                      params: {
                        seed: "local_heuristic_subject_mask",
                      },
                    },
                  }
                : {}),
            },
          ];
        },
      ),
      cleanPlate: {
        asset: {
          id: "heuristic-clean-plate-asset",
          kind: "clean_plate",
          src: cleanPlateSrc,
          width: params.image.width,
          height: params.image.height,
          hasAlpha: false,
          createdAt: generatedAt,
          params: {
            seed: "local_heuristic_clean_plate",
          },
        },
        message:
          "当前 clean plate 来自本地 heuristic 近似修补；进入编辑后仍需人工核对主体移动边缘。",
      },
      ...(textOcrProviderLabel ? { textOcrProviderLabel } : {}),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "本地 heuristic clean plate 生成失败";

    return {
      candidates: seedCandidates.flatMap(
        (candidate): LayeredDesignFlatImageStructuredCandidate[] => {
          const detectedTextCandidate = detectedTextCandidateById.get(
            candidate.id,
          );
          if (detectedTextCandidate) {
            return detectedTextCandidate.candidates;
          }

          if (!isImageCandidateInput(candidate)) {
            return [];
          }

          return [
            {
              id: candidate.id,
              type: "image",
              role: candidate.role,
              name: candidate.layer.name,
              confidence: candidate.confidence,
              selected: candidate.selected,
              issues: candidate.issues,
              rect: {
                x: candidate.layer.x,
                y: candidate.layer.y,
                width: candidate.layer.width,
                height: candidate.layer.height,
              },
              zIndex: candidate.layer.zIndex,
              prompt: candidate.layer.prompt,
              image: findPrimaryCandidateAsset(candidate),
            },
          ];
        },
      ),
      cleanPlate: {
        status: "failed",
        message,
      },
      ...(textOcrProviderLabel ? { textOcrProviderLabel } : {}),
    };
  }
}

export function createLayeredDesignFlatImageAnalysisResultFromStructuredResult(
  params: CreateLayeredDesignFlatImageAnalysisResultFromStructuredResultParams,
): LayeredDesignFlatImageAnalysisResult {
  const generatedAt = params.generatedAt ?? nowIso();
  const candidates = params.candidates.map((candidate) =>
    createCandidateInput(candidate, generatedAt),
  );
  const cleanPlate = createCleanPlateInput(params.cleanPlate, generatedAt);

  return {
    analysis: {
      analyzer: {
        kind: params.analyzer.kind ?? "unknown",
        label: params.analyzer.label,
      },
      outputs: {
        candidateRaster: params.candidates.some(
          (candidate) => candidate.type === "image",
        ),
        candidateMask: params.candidates.some(
          (candidate) => candidate.type === "image" && Boolean(candidate.mask),
        ),
        cleanPlate: cleanPlate.status === "succeeded",
        ocrText: params.candidates.some((candidate) => candidate.type === "text"),
      },
      ...(params.providerCapabilities && params.providerCapabilities.length > 0
        ? { providerCapabilities: params.providerCapabilities }
        : {}),
      generatedAt,
    },
    candidates,
    cleanPlate,
  };
}

async function analyzeWithStructuredAnalyzerProvider(
  params: AnalyzeLayeredDesignFlatImageParams,
  generatedAt: string,
): Promise<LayeredDesignFlatImageAnalysisResult | null> {
  const provider = params.structuredAnalyzerProvider;
  if (!provider) {
    return null;
  }

  const structured = await provider.analyze({
    image: params.image,
    createdAt: generatedAt,
    textOcrProvider: params.textOcrProvider,
  });

  return createLayeredDesignFlatImageAnalysisResultFromStructuredResult({
    ...structured,
    generatedAt: structured.generatedAt ?? generatedAt,
  });
}

export const analyzeLayeredDesignFlatImage: AnalyzeLayeredDesignFlatImage =
  async (params) => {
    const generatedAt = params.createdAt ?? nowIso();
    const providerResult = await analyzeWithStructuredAnalyzerProvider(
      params,
      generatedAt,
    );
    if (providerResult) {
      return providerResult;
    }

    const seed = await createLayeredDesignFlatImageHeuristicSeed(params);
    const structured = await buildLocalHeuristicStructuredResult(
      params,
      seed.candidates,
      generatedAt,
    );

    return createLayeredDesignFlatImageAnalysisResultFromStructuredResult({
      providerCapabilities: resolveLocalHeuristicProviderCapabilities({
        cleanPlate: structured.cleanPlate,
        textOcrProviderLabel: structured.textOcrProviderLabel,
      }),
      analyzer: {
        kind: "local_heuristic",
        label: structured.textOcrProviderLabel
          ? `本地 heuristic analyzer + ${structured.textOcrProviderLabel}`
          : "本地 heuristic analyzer",
      },
      candidates: structured.candidates,
      cleanPlate: structured.cleanPlate,
      generatedAt,
    });
  };

export function createLayeredDesignFlatImageAnalyzerFromStructuredProvider(
  provider: LayeredDesignFlatImageStructuredAnalyzerProvider,
  options: CreateLayeredDesignFlatImageAnalyzerFromStructuredProviderOptions = {},
): AnalyzeLayeredDesignFlatImage {
  return async (params) => {
    const textOcrProvider =
      params.textOcrProvider === undefined
        ? options.textOcrProvider
        : params.textOcrProvider;

    try {
      return await analyzeLayeredDesignFlatImage({
        ...params,
        structuredAnalyzerProvider: provider,
        textOcrProvider,
      });
    } catch (error) {
      if (options.fallbackAnalyzer === null) {
        throw error;
      }

      const fallbackAnalyzer =
        options.fallbackAnalyzer ?? analyzeLayeredDesignFlatImage;
      return await fallbackAnalyzer({
        ...params,
        structuredAnalyzerProvider: null,
        textOcrProvider,
      });
    }
  };
}
