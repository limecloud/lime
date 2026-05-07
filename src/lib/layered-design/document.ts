import type {
  BaseDesignLayer,
  CreateLayeredDesignDocumentParams,
  DesignLayer,
  DesignLayerInput,
  DesignLayerTransform,
  DesignPreviewProjection,
  GeneratedDesignAsset,
  ImageLayer,
  ImageLayerInput,
  LayerEditActor,
  LayerEditRecord,
  LayeredDesignExtractionAnalysis,
  LayeredDesignExtractionAnalysisInput,
  LayeredDesignExtraction,
  LayeredDesignExtractionCandidate,
  LayeredDesignExtractionCandidateInput,
  LayeredDesignExtractionInput,
  LayeredDesignExtractionReview,
  LayerTransformPatch,
  LayeredDesignDocument,
  LayeredDesignDocumentInput,
  ShapeLayer,
  ShapeLayerInput,
  TextLayer,
  TextLayerInput,
} from "./types";
import { LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION } from "./types";

export interface ReplaceImageLayerAssetParams {
  layerId: string;
  asset: GeneratedDesignAsset;
  editId?: string;
  editedAt?: string;
  actor?: LayerEditActor;
  summary?: string;
}

export interface UpdateLayerTransformParams {
  layerId: string;
  transform: LayerTransformPatch;
  editId?: string;
  editedAt?: string;
  actor?: LayerEditActor;
  summary?: string;
}

export interface UpdateLayerVisibilityParams {
  layerId: string;
  visible: boolean;
  editId?: string;
  editedAt?: string;
  actor?: LayerEditActor;
  summary?: string;
}

export interface UpdateLayerLockParams {
  layerId: string;
  locked: boolean;
  editId?: string;
  editedAt?: string;
  actor?: LayerEditActor;
  summary?: string;
}

export interface UpdateTextLayerPropertiesParams {
  layerId: string;
  text?: string;
  fontSize?: number;
  color?: string;
  align?: TextLayer["align"];
  editId?: string;
  editedAt?: string;
  actor?: LayerEditActor;
  summary?: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const normalizeNumber = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) ? value : fallback;

const normalizeOpacity = (value: unknown, fallback: number): number => {
  const normalized = normalizeNumber(value, fallback);
  return Math.min(1, Math.max(0, normalized));
};

function normalizeTextLayerFontSize(value: unknown, fallback: number): number {
  return Math.min(512, Math.max(1, normalizeNumber(value, fallback)));
}

function isTextLayerAlign(value: unknown): value is TextLayer["align"] {
  return value === "left" || value === "center" || value === "right";
}

const nowIso = (): string => new Date().toISOString();
const DEFAULT_EXTRACTION_BACKGROUND_LAYER_ID = "extraction-background-image";
const DEFAULT_EXTRACTION_SELECTION_THRESHOLD = 0.6;

function normalizeBaseLayer(
  layer: DesignLayerInput,
  fallbackZIndex: number,
): BaseDesignLayer {
  const base: BaseDesignLayer = {
    id: layer.id,
    name: layer.name,
    x: normalizeNumber(layer.x, 0),
    y: normalizeNumber(layer.y, 0),
    width: normalizeNumber(layer.width, 0),
    height: normalizeNumber(layer.height, 0),
    visible: layer.visible ?? true,
    locked: layer.locked ?? false,
    rotation: normalizeNumber(layer.rotation, 0),
    opacity: normalizeOpacity(layer.opacity, 1),
    zIndex: normalizeNumber(layer.zIndex, fallbackZIndex),
    source: layer.source ?? "planned",
  };

  if (layer.blendMode) {
    return {
      ...base,
      blendMode: layer.blendMode,
      ...(layer.params ? { params: { ...layer.params } } : {}),
    };
  }

  return {
    ...base,
    ...(layer.params ? { params: { ...layer.params } } : {}),
  };
}

function normalizeDesignLayer(
  layer: DesignLayerInput,
  fallbackZIndex: number,
): DesignLayer {
  const base = normalizeBaseLayer(layer, fallbackZIndex);

  switch (layer.type) {
    case "image":
    case "effect":
      return {
        ...base,
        type: layer.type,
        assetId: layer.assetId,
        alphaMode: layer.alphaMode ?? "embedded",
        ...(layer.maskAssetId !== undefined
          ? { maskAssetId: layer.maskAssetId }
          : {}),
        ...(layer.prompt !== undefined ? { prompt: layer.prompt } : {}),
      };
    case "text":
      return {
        ...base,
        type: "text",
        text: layer.text,
        fontSize: normalizeTextLayerFontSize(layer.fontSize, 24),
        color: layer.color ?? "#111111",
        align: layer.align ?? "left",
        ...(layer.fontFamily !== undefined
          ? { fontFamily: layer.fontFamily }
          : {}),
        ...(layer.lineHeight !== undefined
          ? { lineHeight: layer.lineHeight }
          : {}),
        ...(layer.letterSpacing !== undefined
          ? { letterSpacing: layer.letterSpacing }
          : {}),
      };
    case "shape":
      return {
        ...base,
        type: "shape",
        shape: layer.shape ?? "rect",
        ...(layer.fill !== undefined ? { fill: layer.fill } : {}),
        ...(layer.stroke !== undefined ? { stroke: layer.stroke } : {}),
        ...(layer.strokeWidth !== undefined
          ? { strokeWidth: layer.strokeWidth }
          : {}),
      };
    case "group":
      return {
        ...base,
        type: "group",
        children: [...(layer.children ?? [])],
      };
  }
}

function normalizeConfidence(value: unknown, fallback: number): number {
  const numeric = normalizeNumber(value, fallback);
  const normalized =
    numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  return Math.min(1, Math.max(0, normalized));
}

function normalizeExtractionThreshold(value: unknown): number {
  return normalizeConfidence(value, DEFAULT_EXTRACTION_SELECTION_THRESHOLD);
}

function readExtractionLayerAssetIds(
  layer: DesignLayerInput | DesignLayer,
): string[] {
  if (layer.type !== "image" && layer.type !== "effect") {
    return [];
  }

  return [layer.assetId, layer.maskAssetId]
    .filter((assetId): assetId is string => typeof assetId === "string")
    .filter((assetId, index, all) => all.indexOf(assetId) === index);
}

function normalizeExtractionCandidate(
  candidate: LayeredDesignExtractionCandidateInput,
  threshold: number,
): LayeredDesignExtractionCandidate {
  const confidence = normalizeConfidence(candidate.confidence, 0);
  const layer = normalizeDesignLayer(
    {
      ...candidate.layer,
      source: "extracted",
    },
    candidate.layer.zIndex ?? 0,
  );
  const assetIds = [
    ...(candidate.assetIds ?? []),
    ...readExtractionLayerAssetIds(layer),
    ...(candidate.assets ?? []).map((asset) => asset.id),
  ].filter(
    (assetId, index, all): assetId is string =>
      typeof assetId === "string" &&
      assetId.trim().length > 0 &&
      all.indexOf(assetId) === index,
  );
  const issues = [
    ...(candidate.issues ?? []),
    ...(confidence < threshold ? ["low_confidence" as const] : []),
  ].filter((issue, index, all) => all.indexOf(issue) === index);

  return {
    id: candidate.id,
    role: candidate.role,
    confidence,
    selected: candidate.selected ?? confidence >= threshold,
    layer,
    assetIds,
    ...(issues.length > 0 ? { issues } : {}),
  };
}

function normalizeLayeredDesignExtraction(
  extraction: LayeredDesignExtractionInput | undefined,
): LayeredDesignExtraction | undefined {
  if (!extraction) {
    return undefined;
  }

  const threshold = normalizeExtractionThreshold(
    extraction.candidateSelectionThreshold,
  );
  const cleanPlateAssetId =
    extraction.cleanPlate?.assetId ?? extraction.cleanPlate?.asset?.id;
  const cleanPlateStatus =
    extraction.cleanPlate?.status ??
    (cleanPlateAssetId ? "succeeded" : "not_requested");
  const normalizedAnalysis = normalizeExtractionAnalysis(extraction.analysis);
  const reviewStatus =
    extraction.review?.status ??
    (typeof extraction.review?.confirmedAt === "string" &&
    extraction.review.confirmedAt.trim().length > 0
      ? "confirmed"
      : "pending");

  return {
    sourceAssetId: extraction.sourceAssetId,
    backgroundLayerId:
      extraction.backgroundLayerId?.trim() ||
      DEFAULT_EXTRACTION_BACKGROUND_LAYER_ID,
    candidateSelectionThreshold: threshold,
    review: {
      status: reviewStatus,
      ...(typeof extraction.review?.confirmedAt === "string" &&
      extraction.review.confirmedAt.trim().length > 0
        ? { confirmedAt: extraction.review.confirmedAt }
        : {}),
    },
    ...(normalizedAnalysis ? { analysis: normalizedAnalysis } : {}),
    cleanPlate: {
      status: cleanPlateStatus,
      ...(cleanPlateAssetId ? { assetId: cleanPlateAssetId } : {}),
      ...(extraction.cleanPlate?.message
        ? { message: extraction.cleanPlate.message }
        : {}),
    },
    candidates: (extraction.candidates ?? []).map((candidate) =>
      normalizeExtractionCandidate(candidate, threshold),
    ),
  };
}

function normalizeExtractionAnalysis(
  analysis: LayeredDesignExtractionAnalysisInput | undefined,
): LayeredDesignExtractionAnalysis | undefined {
  if (!analysis) {
    return undefined;
  }

  const label = analysis.analyzer.label?.trim();
  if (!label) {
    return undefined;
  }

  return {
    analyzer: {
      kind: analysis.analyzer.kind ?? "unknown",
      label,
    },
    outputs: {
      candidateRaster: analysis.outputs?.candidateRaster ?? false,
      candidateMask: analysis.outputs?.candidateMask ?? false,
      cleanPlate: analysis.outputs?.cleanPlate ?? false,
      ocrText: analysis.outputs?.ocrText ?? false,
    },
    ...(analysis.providerCapabilities &&
    analysis.providerCapabilities.length > 0
      ? {
          providerCapabilities: analysis.providerCapabilities.map(
            (capability) => ({
              ...capability,
              supports: { ...capability.supports },
              ...(capability.limits
                ? { limits: { ...capability.limits } }
                : {}),
              ...(capability.quality
                ? { quality: { ...capability.quality } }
                : {}),
            }),
          ),
        }
      : {}),
    ...(typeof analysis.generatedAt === "string" &&
    analysis.generatedAt.trim().length > 0
      ? { generatedAt: analysis.generatedAt }
      : {}),
  };
}

function copyGeneratedAsset(asset: GeneratedDesignAsset): GeneratedDesignAsset {
  return {
    ...asset,
    ...(asset.params ? { params: { ...asset.params } } : {}),
  };
}

function collectExtractionGeneratedAssets(
  extraction: LayeredDesignExtractionInput | undefined,
): GeneratedDesignAsset[] {
  if (!extraction) {
    return [];
  }

  return [
    ...(extraction.cleanPlate?.asset ? [extraction.cleanPlate.asset] : []),
    ...(extraction.candidates ?? []).flatMap((candidate) => candidate.assets ?? []),
  ].map(copyGeneratedAsset);
}

function normalizePreviewProjection(
  preview: LayeredDesignDocumentInput["preview"],
): DesignPreviewProjection | undefined {
  if (!preview) {
    return undefined;
  }

  return {
    ...preview,
    stale: preview.stale ?? false,
  };
}

function markPreviewStale(
  preview: DesignPreviewProjection | undefined,
): DesignPreviewProjection | undefined {
  if (!preview) {
    return undefined;
  }

  return {
    ...preview,
    stale: true,
  };
}

function copyEditRecord(record: LayerEditRecord): LayerEditRecord {
  return {
    ...record,
    ...(record.transformBefore
      ? { transformBefore: { ...record.transformBefore } }
      : {}),
    ...(record.transformAfter
      ? { transformAfter: { ...record.transformAfter } }
      : {}),
  };
}

function copyLayeredDesignExtraction(
  extraction: LayeredDesignExtraction | undefined,
): LayeredDesignExtraction | undefined {
  if (!extraction) {
    return undefined;
  }

  return {
    sourceAssetId: extraction.sourceAssetId,
    backgroundLayerId: extraction.backgroundLayerId,
    candidateSelectionThreshold: extraction.candidateSelectionThreshold,
    review: copyLayeredDesignExtractionReview(extraction.review),
    ...(extraction.analysis
      ? { analysis: copyLayeredDesignExtractionAnalysis(extraction.analysis) }
      : {}),
    cleanPlate: { ...extraction.cleanPlate },
    candidates: extraction.candidates.map((candidate) => ({
      ...candidate,
      layer: normalizeDesignLayer(candidate.layer, candidate.layer.zIndex),
      assetIds: [...candidate.assetIds],
      ...(candidate.issues ? { issues: [...candidate.issues] } : {}),
    })),
  };
}

function copyLayeredDesignExtractionReview(
  review: LayeredDesignExtractionReview,
): LayeredDesignExtractionReview {
  return {
    status: review.status,
    ...(review.confirmedAt ? { confirmedAt: review.confirmedAt } : {}),
  };
}

function copyLayeredDesignExtractionAnalysis(
  analysis: LayeredDesignExtractionAnalysis,
): LayeredDesignExtractionAnalysis {
  return {
    analyzer: {
      kind: analysis.analyzer.kind,
      label: analysis.analyzer.label,
    },
    outputs: {
      candidateRaster: analysis.outputs.candidateRaster,
      candidateMask: analysis.outputs.candidateMask,
      cleanPlate: analysis.outputs.cleanPlate,
      ocrText: analysis.outputs.ocrText,
    },
    ...(analysis.providerCapabilities && analysis.providerCapabilities.length > 0
      ? {
          providerCapabilities: analysis.providerCapabilities.map(
            (capability) => ({
              ...capability,
              supports: { ...capability.supports },
              ...(capability.limits
                ? { limits: { ...capability.limits } }
                : {}),
              ...(capability.quality
                ? { quality: { ...capability.quality } }
                : {}),
            }),
          ),
        }
      : {}),
    ...(analysis.generatedAt ? { generatedAt: analysis.generatedAt } : {}),
  };
}

function upsertGeneratedAsset(
  assets: GeneratedDesignAsset[],
  asset: GeneratedDesignAsset,
): GeneratedDesignAsset[] {
  const copiedAsset = copyGeneratedAsset(asset);
  const existingIndex = assets.findIndex((item) => item.id === asset.id);

  if (existingIndex === -1) {
    return [...assets.map(copyGeneratedAsset), copiedAsset];
  }

  return assets.map((item, index) =>
    index === existingIndex ? copiedAsset : copyGeneratedAsset(item),
  );
}

function createEditId(
  document: LayeredDesignDocument,
  type: LayerEditRecord["type"],
): string {
  return `${type}-${document.editHistory.length + 1}`;
}

function readTransform(layer: DesignLayer): DesignLayerTransform {
  return {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    rotation: layer.rotation,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
  };
}

function resolveLayerOrThrow(
  document: LayeredDesignDocument,
  layerId: string,
): DesignLayer {
  const layer = document.layers.find((item) => item.id === layerId);
  if (!layer) {
    throw new Error(`未找到图层：${layerId}`);
  }

  return layer;
}

function updateExtractionTextCandidateLayer(
  extraction: LayeredDesignExtraction | undefined,
  textLayer: TextLayer,
): LayeredDesignExtraction | undefined {
  const copiedExtraction = copyLayeredDesignExtraction(extraction);
  if (!copiedExtraction) {
    return undefined;
  }

  return {
    ...copiedExtraction,
    candidates: copiedExtraction.candidates.map((candidate) => {
      if (candidate.layer.id !== textLayer.id || candidate.layer.type !== "text") {
        return candidate;
      }

      return {
        ...candidate,
        layer: {
          ...candidate.layer,
          text: textLayer.text,
          fontSize: textLayer.fontSize,
          color: textLayer.color,
          align: textLayer.align,
        },
      };
    }),
  };
}

export function isImageDesignLayer(
  layer: DesignLayer | undefined,
): layer is ImageLayer {
  return layer?.type === "image" || layer?.type === "effect";
}

export function sortDesignLayers(layers: DesignLayer[]): DesignLayer[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => {
      const zIndexDelta = left.layer.zIndex - right.layer.zIndex;
      return zIndexDelta !== 0 ? zIndexDelta : left.index - right.index;
    })
    .map(({ layer }) => layer);
}

export function normalizeLayeredDesignDocument(
  document: LayeredDesignDocumentInput,
): LayeredDesignDocument {
  const createdAt = document.createdAt ?? nowIso();
  const updatedAt = document.updatedAt ?? createdAt;
  const layers = sortDesignLayers(
    (document.layers ?? []).map((layer, index) =>
      normalizeDesignLayer(layer, index),
    ),
  );
  const assets = [...(document.assets ?? []), ...collectExtractionGeneratedAssets(document.extraction)].reduce<GeneratedDesignAsset[]>(
    (allAssets, asset) => upsertGeneratedAsset(allAssets, asset),
    [],
  );
  const extraction = normalizeLayeredDesignExtraction(document.extraction);

  return {
    schemaVersion: LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION,
    id: document.id,
    title: document.title,
    status: document.status ?? "draft",
    canvas: { ...document.canvas },
    layers,
    assets,
    ...(extraction ? { extraction: copyLayeredDesignExtraction(extraction) } : {}),
    ...(document.preview
      ? { preview: normalizePreviewProjection(document.preview) }
      : {}),
    editHistory: (document.editHistory ?? []).map(copyEditRecord),
    createdAt,
    updatedAt,
  };
}

export function createLayeredDesignDocument(
  params: CreateLayeredDesignDocumentParams,
): LayeredDesignDocument {
  return normalizeLayeredDesignDocument(params);
}

export function createDesignLayer(params: DesignLayerInput): DesignLayer {
  return normalizeDesignLayer(params, params.zIndex ?? 0);
}

export function createImageLayer(params: ImageLayerInput): ImageLayer {
  const layer = createDesignLayer(params);
  if (!isImageDesignLayer(layer)) {
    throw new Error("createImageLayer 只能创建 image/effect 图层");
  }

  return layer;
}

export function createTextLayer(params: TextLayerInput): TextLayer {
  const layer = createDesignLayer(params);
  if (layer.type !== "text") {
    throw new Error("createTextLayer 只能创建 text 图层");
  }

  return layer;
}

export function createShapeLayer(params: ShapeLayerInput): ShapeLayer {
  const layer = createDesignLayer(params);
  if (layer.type !== "shape") {
    throw new Error("createShapeLayer 只能创建 shape 图层");
  }

  return layer;
}

export function replaceImageLayerAsset(
  document: LayeredDesignDocument,
  params: ReplaceImageLayerAssetParams,
): LayeredDesignDocument {
  const targetLayer = resolveLayerOrThrow(document, params.layerId);
  if (!isImageDesignLayer(targetLayer)) {
    throw new Error(`图层不支持替换图片资产：${params.layerId}`);
  }

  const editedAt = params.editedAt ?? nowIso();
  const editRecord: LayerEditRecord = {
    id: params.editId ?? createEditId(document, "asset_replaced"),
    type: "asset_replaced",
    layerId: targetLayer.id,
    actor: params.actor ?? "assistant",
    previousAssetId: targetLayer.assetId,
    nextAssetId: params.asset.id,
    createdAt: editedAt,
    ...(params.summary ? { summary: params.summary } : {}),
  };

  const layers = document.layers.map((layer): DesignLayer => {
    if (layer.id !== targetLayer.id || !isImageDesignLayer(layer)) {
      return layer;
    }

    return {
      ...layer,
      assetId: params.asset.id,
    };
  });

  return {
    ...document,
    layers: sortDesignLayers(layers),
    assets: upsertGeneratedAsset(document.assets, params.asset),
    preview: markPreviewStale(document.preview),
    editHistory: [...document.editHistory.map(copyEditRecord), editRecord],
    updatedAt: editedAt,
  };
}

export function updateTextLayerProperties(
  document: LayeredDesignDocument,
  params: UpdateTextLayerPropertiesParams,
): LayeredDesignDocument {
  const targetLayer = resolveLayerOrThrow(document, params.layerId);
  if (targetLayer.type !== "text") {
    throw new Error(`图层不支持编辑文字内容：${params.layerId}`);
  }

  const nextLayer: TextLayer = {
    ...targetLayer,
    text: params.text ?? targetLayer.text,
    fontSize:
      params.fontSize !== undefined
        ? normalizeTextLayerFontSize(params.fontSize, targetLayer.fontSize)
        : targetLayer.fontSize,
    color:
      typeof params.color === "string" && params.color.trim().length > 0
        ? params.color
        : targetLayer.color,
    align: isTextLayerAlign(params.align) ? params.align : targetLayer.align,
  };
  const changed =
    nextLayer.text !== targetLayer.text ||
    nextLayer.fontSize !== targetLayer.fontSize ||
    nextLayer.color !== targetLayer.color ||
    nextLayer.align !== targetLayer.align;

  if (!changed) {
    return document;
  }

  const editedAt = params.editedAt ?? nowIso();
  const editRecord: LayerEditRecord = {
    id: params.editId ?? createEditId(document, "text_updated"),
    type: "text_updated",
    layerId: targetLayer.id,
    actor: params.actor ?? "user",
    previousText: targetLayer.text,
    nextText: nextLayer.text,
    previousFontSize: targetLayer.fontSize,
    nextFontSize: nextLayer.fontSize,
    previousColor: targetLayer.color,
    nextColor: nextLayer.color,
    previousAlign: targetLayer.align,
    nextAlign: nextLayer.align,
    createdAt: editedAt,
    ...(params.summary ? { summary: params.summary } : {}),
  };

  const layers = document.layers.map((layer): DesignLayer => {
    if (layer.id !== targetLayer.id) {
      return layer;
    }

    return nextLayer;
  });

  return {
    ...document,
    layers: sortDesignLayers(layers),
    ...(document.extraction
      ? {
          extraction: updateExtractionTextCandidateLayer(
            document.extraction,
            nextLayer,
          )!,
        }
      : {}),
    preview: markPreviewStale(document.preview),
    editHistory: [...document.editHistory.map(copyEditRecord), editRecord],
    updatedAt: editedAt,
  };
}

export function updateLayerTransform(
  document: LayeredDesignDocument,
  params: UpdateLayerTransformParams,
): LayeredDesignDocument {
  const targetLayer = resolveLayerOrThrow(document, params.layerId);
  const before = readTransform(targetLayer);
  const after: DesignLayerTransform = {
    x: normalizeNumber(params.transform.x, before.x),
    y: normalizeNumber(params.transform.y, before.y),
    width: normalizeNumber(params.transform.width, before.width),
    height: normalizeNumber(params.transform.height, before.height),
    rotation: normalizeNumber(params.transform.rotation, before.rotation),
    opacity: normalizeOpacity(params.transform.opacity, before.opacity),
    zIndex: normalizeNumber(params.transform.zIndex, before.zIndex),
  };
  const editedAt = params.editedAt ?? nowIso();
  const editRecord: LayerEditRecord = {
    id: params.editId ?? createEditId(document, "transform_updated"),
    type: "transform_updated",
    layerId: targetLayer.id,
    actor: params.actor ?? "user",
    transformBefore: before,
    transformAfter: after,
    createdAt: editedAt,
    ...(params.summary ? { summary: params.summary } : {}),
  };

  const layers = document.layers.map((layer): DesignLayer => {
    if (layer.id !== targetLayer.id) {
      return layer;
    }

    return {
      ...layer,
      ...after,
    };
  });

  return {
    ...document,
    layers: sortDesignLayers(layers),
    preview: markPreviewStale(document.preview),
    editHistory: [...document.editHistory.map(copyEditRecord), editRecord],
    updatedAt: editedAt,
  };
}

export function updateLayerVisibility(
  document: LayeredDesignDocument,
  params: UpdateLayerVisibilityParams,
): LayeredDesignDocument {
  const targetLayer = resolveLayerOrThrow(document, params.layerId);
  const editedAt = params.editedAt ?? nowIso();
  const editRecord: LayerEditRecord = {
    id: params.editId ?? createEditId(document, "visibility_updated"),
    type: "visibility_updated",
    layerId: targetLayer.id,
    actor: params.actor ?? "user",
    previousVisible: targetLayer.visible,
    nextVisible: params.visible,
    createdAt: editedAt,
    ...(params.summary ? { summary: params.summary } : {}),
  };

  return {
    ...document,
    layers: document.layers.map((layer) =>
      layer.id === targetLayer.id
        ? {
            ...layer,
            visible: params.visible,
          }
        : layer,
    ),
    preview: markPreviewStale(document.preview),
    editHistory: [...document.editHistory.map(copyEditRecord), editRecord],
    updatedAt: editedAt,
  };
}

export function updateLayerLock(
  document: LayeredDesignDocument,
  params: UpdateLayerLockParams,
): LayeredDesignDocument {
  const targetLayer = resolveLayerOrThrow(document, params.layerId);
  const editedAt = params.editedAt ?? nowIso();
  const editRecord: LayerEditRecord = {
    id: params.editId ?? createEditId(document, "lock_updated"),
    type: "lock_updated",
    layerId: targetLayer.id,
    actor: params.actor ?? "user",
    previousLocked: targetLayer.locked,
    nextLocked: params.locked,
    createdAt: editedAt,
    ...(params.summary ? { summary: params.summary } : {}),
  };

  return {
    ...document,
    layers: document.layers.map((layer) =>
      layer.id === targetLayer.id
        ? {
            ...layer,
            locked: params.locked,
          }
        : layer,
    ),
    preview: markPreviewStale(document.preview),
    editHistory: [...document.editHistory.map(copyEditRecord), editRecord],
    updatedAt: editedAt,
  };
}
