import type {
  GeneratedDesignAssetKind,
  LayeredDesignExtractionCandidateInput,
  LayeredDesignExtractionCleanPlateInput,
  LayeredDesignExtractionCandidateRole,
} from "./types";

export interface LayeredDesignFlatImageHeuristicCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayeredDesignFlatImageHeuristicSeedImage {
  src: string;
  width: number;
  height: number;
  mimeType?: string;
  hasAlpha?: boolean;
}

export interface CreateLayeredDesignFlatImageHeuristicSeedParams {
  image: LayeredDesignFlatImageHeuristicSeedImage;
  createdAt?: string;
}

export interface LayeredDesignFlatImageHeuristicSeed {
  candidates: LayeredDesignExtractionCandidateInput[];
  cleanPlate: LayeredDesignExtractionCleanPlateInput;
}

export interface LayeredDesignFlatImageHeuristicCandidateSpec {
  id: string;
  name: string;
  role: LayeredDesignExtractionCandidateRole;
  kind: GeneratedDesignAssetKind;
  rect: LayeredDesignFlatImageHeuristicCropRect;
  confidence: number;
  zIndex: number;
}

const nowIso = (): string => new Date().toISOString();

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createCropRect(
  imageWidth: number,
  imageHeight: number,
  leftRatio: number,
  topRatio: number,
  widthRatio: number,
  heightRatio: number,
): LayeredDesignFlatImageHeuristicCropRect {
  const width = clamp(
    Math.round(imageWidth * widthRatio),
    Math.min(72, imageWidth),
    imageWidth,
  );
  const height = clamp(
    Math.round(imageHeight * heightRatio),
    Math.min(72, imageHeight),
    imageHeight,
  );
  const x = clamp(Math.round(imageWidth * leftRatio), 0, imageWidth - width);
  const y = clamp(Math.round(imageHeight * topRatio), 0, imageHeight - height);

  return { x, y, width, height };
}

export function buildLayeredDesignFlatImageHeuristicCandidateSpecs(
  imageWidth: number,
  imageHeight: number,
): LayeredDesignFlatImageHeuristicCandidateSpec[] {
  return [
    {
      id: "subject",
      name: "主体候选",
      role: "subject",
      kind: "subject",
      rect: createCropRect(imageWidth, imageHeight, 0.16, 0.16, 0.68, 0.7),
      confidence: 0.74,
      zIndex: 20,
    },
    {
      id: "headline",
      name: "标题文字候选",
      role: "text",
      kind: "text_raster",
      rect: createCropRect(imageWidth, imageHeight, 0.12, 0.06, 0.76, 0.18),
      confidence: 0.62,
      zIndex: 40,
    },
    {
      id: "body-text",
      name: "正文/按钮文字候选",
      role: "text",
      kind: "text_raster",
      rect: createCropRect(imageWidth, imageHeight, 0.18, 0.76, 0.64, 0.14),
      confidence: 0.6,
      zIndex: 42,
    },
    {
      id: "logo",
      name: "Logo 候选",
      role: "logo",
      kind: "logo",
      rect: createCropRect(imageWidth, imageHeight, 0.06, 0.06, 0.28, 0.16),
      confidence: 0.48,
      zIndex: 48,
    },
    {
      id: "fragment",
      name: "边角碎片",
      role: "background_fragment",
      kind: "effect",
      rect: createCropRect(imageWidth, imageHeight, 0.72, 0.72, 0.22, 0.22),
      confidence: 0.22,
      zIndex: 56,
    },
  ];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new window.Image();

  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("本地 heuristic seed 读取图片失败"));
    image.src = src;
  });
}

function cropImageToPngDataUrl(
  image: HTMLImageElement,
  rect: LayeredDesignFlatImageHeuristicCropRect,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("当前环境不支持本地 heuristic 裁片");
  }

  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );

  return canvas.toDataURL("image/png");
}

export async function createLayeredDesignFlatImageHeuristicSeed(
  params: CreateLayeredDesignFlatImageHeuristicSeedParams,
): Promise<LayeredDesignFlatImageHeuristicSeed> {
  const image = await loadImage(params.image.src);
  const imageWidth = normalizePositiveInteger(
    image.naturalWidth || image.width || params.image.width,
    1,
  );
  const imageHeight = normalizePositiveInteger(
    image.naturalHeight || image.height || params.image.height,
    1,
  );
  const createdAt = params.createdAt ?? nowIso();
  const specs = buildLayeredDesignFlatImageHeuristicCandidateSpecs(
    imageWidth,
    imageHeight,
  );

  return {
    candidates: specs.map((spec) => {
      const assetId = `${spec.id}-asset`;
      return {
        id: `${spec.id}-candidate`,
        role: spec.role,
        confidence: spec.confidence,
        layer: {
          id: `${spec.id}-layer`,
          name: spec.name,
          type: "image",
          assetId,
          x: spec.rect.x,
          y: spec.rect.y,
          width: spec.rect.width,
          height: spec.rect.height,
          zIndex: spec.zIndex,
          alphaMode: "embedded",
        },
        assets: [
          {
            id: assetId,
            kind: spec.kind,
            src: cropImageToPngDataUrl(image, spec.rect),
            width: spec.rect.width,
            height: spec.rect.height,
            hasAlpha: params.image.hasAlpha ?? false,
            createdAt,
            params: {
              seed: "local_heuristic_crop",
              inputMimeType: params.image.mimeType ?? "image/*",
              outputMimeType: "image/png",
              sourceRect: { ...spec.rect },
            },
          },
        ],
      };
    }),
    cleanPlate: {
      status: "not_requested",
      message: "当前候选来自本地 heuristic 裁片；尚未执行 clean plate。",
    },
  };
}
