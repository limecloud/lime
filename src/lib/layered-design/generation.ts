import {
  isImageDesignLayer,
  normalizeLayeredDesignDocument,
  replaceImageLayerAsset,
  sortDesignLayers,
} from "./document";
import type {
  DesignLayer,
  GeneratedDesignAsset,
  GeneratedDesignAssetKind,
  ImageLayer,
  LayerEditActor,
  LayeredDesignDocument,
  LayeredDesignDocumentInput,
} from "./types";

export type LayeredDesignAssetGenerationTarget = "document" | "layer";

export interface LayeredDesignAssetGenerationRequest {
  id: string;
  documentId: string;
  layerId: string;
  assetId: string;
  kind: GeneratedDesignAssetKind;
  prompt: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  alphaMode: ImageLayer["alphaMode"];
  target: LayeredDesignAssetGenerationTarget;
}

export interface CreateLayeredDesignAssetGenerationPlanOptions {
  layerId?: string;
  includeReadyAssets?: boolean;
}

export interface ApplyLayeredDesignGeneratedAssetParams {
  layerId: string;
  asset: GeneratedDesignAsset;
  editId?: string;
  editedAt?: string;
  actor?: LayerEditActor;
  summary?: string;
}

function findAsset(
  document: LayeredDesignDocument,
  assetId: string,
): GeneratedDesignAsset | undefined {
  return document.assets.find((asset) => asset.id === assetId);
}

function isPlannedOnlyAsset(asset: GeneratedDesignAsset | undefined): boolean {
  return asset?.params?.plannedOnly === true;
}

function shouldCreateRequest(
  asset: GeneratedDesignAsset | undefined,
  includeReadyAssets: boolean,
): boolean {
  if (includeReadyAssets) {
    return true;
  }

  return !asset || !asset.src || isPlannedOnlyAsset(asset);
}

function normalizePositiveSize(value: number): number {
  return Math.max(1, Math.round(value));
}

function resolveAssetKind(
  layer: ImageLayer,
  asset: GeneratedDesignAsset | undefined,
): GeneratedDesignAssetKind {
  if (asset?.kind) {
    return asset.kind;
  }

  return layer.type === "effect" ? "effect" : "subject";
}

function resolvePrompt(
  document: LayeredDesignDocument,
  layer: ImageLayer,
  asset: GeneratedDesignAsset | undefined,
): string {
  const layerPrompt = layer.prompt?.trim();
  if (layerPrompt) {
    return layerPrompt;
  }

  const assetPrompt = asset?.prompt?.trim();
  if (assetPrompt) {
    return assetPrompt;
  }

  return `${document.title}｜${layer.name}`;
}

function createGenerationRequest(
  document: LayeredDesignDocument,
  layer: ImageLayer,
  target: LayeredDesignAssetGenerationTarget,
): LayeredDesignAssetGenerationRequest {
  const asset = findAsset(document, layer.assetId);

  return {
    id: `${document.id}:${layer.id}:${layer.assetId}`,
    documentId: document.id,
    layerId: layer.id,
    assetId: layer.assetId,
    kind: resolveAssetKind(layer, asset),
    prompt: resolvePrompt(document, layer, asset),
    width: normalizePositiveSize(asset?.width ?? layer.width),
    height: normalizePositiveSize(asset?.height ?? layer.height),
    hasAlpha: asset?.hasAlpha ?? layer.alphaMode !== "none",
    alphaMode: layer.alphaMode,
    target,
  };
}

function assertImageLayer(
  layers: DesignLayer[],
  layerId: string,
): ImageLayer {
  const layer = layers.find((item) => item.id === layerId);
  if (!isImageDesignLayer(layer)) {
    throw new Error(`未找到可生成的图片图层：${layerId}`);
  }

  return layer;
}

export function createLayeredDesignAssetGenerationPlan(
  documentInput: LayeredDesignDocumentInput | LayeredDesignDocument,
  options: CreateLayeredDesignAssetGenerationPlanOptions = {},
): LayeredDesignAssetGenerationRequest[] {
  const document = normalizeLayeredDesignDocument(documentInput);
  const includeReadyAssets = options.includeReadyAssets ?? false;

  if (options.layerId) {
    const layer = assertImageLayer(document.layers, options.layerId);
    return [createGenerationRequest(document, layer, "layer")];
  }

  return document.layers
    .filter(isImageDesignLayer)
    .filter((layer) =>
      shouldCreateRequest(
        findAsset(document, layer.assetId),
        includeReadyAssets,
      ),
    )
    .map((layer) => createGenerationRequest(document, layer, "document"));
}

export function createSingleLayerAssetGenerationRequest(
  documentInput: LayeredDesignDocumentInput | LayeredDesignDocument,
  layerId: string,
): LayeredDesignAssetGenerationRequest {
  return createLayeredDesignAssetGenerationPlan(documentInput, {
    layerId,
    includeReadyAssets: true,
  })[0];
}

export function applyLayeredDesignGeneratedAsset(
  document: LayeredDesignDocument,
  params: ApplyLayeredDesignGeneratedAssetParams,
): LayeredDesignDocument {
  const updated = replaceImageLayerAsset(document, {
    layerId: params.layerId,
    asset: params.asset,
    editId: params.editId,
    editedAt: params.editedAt,
    actor: params.actor ?? "assistant",
    summary: params.summary ?? `写入生成资产：${params.asset.id}`,
  });

  return {
    ...updated,
    layers: sortDesignLayers(
      updated.layers.map((layer): DesignLayer => {
        if (layer.id !== params.layerId || !isImageDesignLayer(layer)) {
          return layer;
        }

        return {
          ...layer,
          source: "generated",
        };
      }),
    ),
  };
}
