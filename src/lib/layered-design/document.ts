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

function copyGeneratedAsset(asset: GeneratedDesignAsset): GeneratedDesignAsset {
  return {
    ...asset,
    ...(asset.params ? { params: { ...asset.params } } : {}),
  };
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

  return {
    schemaVersion: LAYERED_DESIGN_DOCUMENT_SCHEMA_VERSION,
    id: document.id,
    title: document.title,
    status: document.status ?? "draft",
    canvas: { ...document.canvas },
    layers,
    assets: (document.assets ?? []).map(copyGeneratedAsset),
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

export function createImageLayer(params: ImageLayerInput): ImageLayer {
  const layer = normalizeDesignLayer(params, params.zIndex ?? 0);
  if (!isImageDesignLayer(layer)) {
    throw new Error("createImageLayer 只能创建 image/effect 图层");
  }

  return layer;
}

export function createTextLayer(params: TextLayerInput): TextLayer {
  const layer = normalizeDesignLayer(params, params.zIndex ?? 0);
  if (layer.type !== "text") {
    throw new Error("createTextLayer 只能创建 text 图层");
  }

  return layer;
}

export function createShapeLayer(params: ShapeLayerInput): ShapeLayer {
  const layer = normalizeDesignLayer(params, params.zIndex ?? 0);
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
