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
  LayeredDesignExtraction,
  LayeredDesignExtractionCandidate,
  LayeredDesignExtractionCandidateInput,
  LayeredDesignExtractionInput,
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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const normalizeNumber = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) ? value : fallback;

const normalizeOpacity = (value: unknown, fallback: number): number => {
  const normalized = normalizeNumber(value, fallback);
  return Math.min(1, Math.max(0, normalized));
};

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
    return { ...base, blendMode: layer.blendMode };
  }

  return base;
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
        fontSize: normalizeNumber(layer.fontSize, 24),
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

  return {
    sourceAssetId: extraction.sourceAssetId,
    backgroundLayerId:
      extraction.backgroundLayerId?.trim() ||
      DEFAULT_EXTRACTION_BACKGROUND_LAYER_ID,
    candidateSelectionThreshold: threshold,
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
    cleanPlate: { ...extraction.cleanPlate },
    candidates: extraction.candidates.map((candidate) => ({
      ...candidate,
      layer: normalizeDesignLayer(candidate.layer, candidate.layer.zIndex),
      assetIds: [...candidate.assetIds],
      ...(candidate.issues ? { issues: [...candidate.issues] } : {}),
    })),
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
