import {
  createDesignLayer,
  createImageLayer,
  isImageDesignLayer,
  normalizeLayeredDesignDocument,
  sortDesignLayers,
} from "./document";
import type {
  DesignLayer,
  GeneratedDesignAsset,
  LayerEditActor,
  LayerEditRecord,
  LayeredDesignDocument,
  LayeredDesignDocumentInput,
  LayeredDesignExtractionAnalysisInput,
  LayeredDesignExtraction,
  LayeredDesignExtractionCandidate,
  LayeredDesignExtractionCandidateInput,
  LayeredDesignExtractionCleanPlateInput,
  LayeredDesignExtractionCleanPlateStatus,
} from "./types";

export interface CreateLayeredDesignExtractionDocumentParams {
  id: string;
  title: string;
  canvas: LayeredDesignDocument["canvas"];
  sourceAsset: GeneratedDesignAsset;
  analysis?: LayeredDesignExtractionAnalysisInput;
  candidates?: LayeredDesignExtractionCandidateInput[];
  cleanPlate?: LayeredDesignExtractionCleanPlateInput;
  candidateSelectionThreshold?: number;
  backgroundLayerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateLayeredDesignExtractionSelectionParams {
  selectedCandidateIds: string[];
  editId?: string;
  editedAt?: string;
  actor?: LayerEditActor;
  summary?: string;
}

export interface ConfirmLayeredDesignExtractionParams {
  editId?: string;
  editedAt?: string;
  actor?: LayerEditActor;
  summary?: string;
}

export interface ReanalyzeLayeredDesignExtractionParams {
  analysis?: LayeredDesignExtractionAnalysisInput;
  candidates?: LayeredDesignExtractionCandidateInput[];
  cleanPlate?: LayeredDesignExtractionCleanPlateInput;
  editId?: string;
  editedAt?: string;
  actor?: LayerEditActor;
  summary?: string;
}

const nowIso = (): string => new Date().toISOString();

function copyGeneratedAsset(asset: GeneratedDesignAsset): GeneratedDesignAsset {
  return {
    ...asset,
    ...(asset.params ? { params: { ...asset.params } } : {}),
  };
}

function dedupeGeneratedAssets(
  assets: GeneratedDesignAsset[],
): GeneratedDesignAsset[] {
  const byId = new Map<string, GeneratedDesignAsset>();
  for (const asset of assets) {
    byId.set(asset.id, copyGeneratedAsset(asset));
  }
  return [...byId.values()];
}

function copyExtractionCandidate(
  candidate: LayeredDesignExtractionCandidate,
): LayeredDesignExtractionCandidate {
  return {
    ...candidate,
    layer: createDesignLayer(candidate.layer),
    assetIds: [...candidate.assetIds],
    ...(candidate.issues ? { issues: [...candidate.issues] } : {}),
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

function resolveCleanPlateAssetId(
  extraction: LayeredDesignExtraction,
): string | undefined {
  return extraction.cleanPlate.status === "succeeded"
    ? extraction.cleanPlate.assetId
    : undefined;
}

function resolveBackgroundAssetId(extraction: LayeredDesignExtraction): string {
  return resolveCleanPlateAssetId(extraction) ?? extraction.sourceAssetId;
}

function resolveBackgroundLayerName(
  extraction: LayeredDesignExtraction,
): string {
  return extraction.cleanPlate.status === "succeeded"
    ? "背景 clean plate"
    : "原始扁平图";
}

function buildExtractionBackgroundLayer(
  document: LayeredDesignDocument,
): DesignLayer {
  const extraction = document.extraction;
  if (!extraction) {
    throw new Error("文档不存在扁平图拆层上下文");
  }

  const existingLayer = document.layers.find(
    (layer) => layer.id === extraction.backgroundLayerId,
  );
  if (isImageDesignLayer(existingLayer)) {
    return createImageLayer({
      ...existingLayer,
      name: existingLayer.name || resolveBackgroundLayerName(extraction),
      assetId: resolveBackgroundAssetId(extraction),
      alphaMode: "none",
      source: "extracted",
    });
  }

  return createImageLayer({
    id: extraction.backgroundLayerId,
    name: resolveBackgroundLayerName(extraction),
    type: "image",
    assetId: resolveBackgroundAssetId(extraction),
    x: 0,
    y: 0,
    width: document.canvas.width,
    height: document.canvas.height,
    zIndex: 0,
    alphaMode: "none",
    source: "extracted",
  });
}

function buildCandidateLayer(
  document: LayeredDesignDocument,
  candidate: LayeredDesignExtractionCandidate,
): DesignLayer {
  const existingLayer = document.layers.find(
    (layer) => layer.id === candidate.layer.id,
  );
  if (!existingLayer) {
    return createDesignLayer(candidate.layer);
  }

  return createDesignLayer({
    ...existingLayer,
    source: "extracted",
  });
}

function syncExtractionLayers(
  document: LayeredDesignDocument,
): LayeredDesignDocument {
  if (!document.extraction) {
    return document;
  }

  const candidateLayerIds = new Set(
    document.extraction.candidates.map((candidate) => candidate.layer.id),
  );
  const preservedLayers = document.layers.filter(
    (layer) =>
      layer.id !== document.extraction?.backgroundLayerId &&
      !candidateLayerIds.has(layer.id),
  );
  const extractionLayers = [
    buildExtractionBackgroundLayer(document),
    ...document.extraction.candidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => buildCandidateLayer(document, candidate)),
  ];

  return {
    ...document,
    layers: sortDesignLayers([...preservedLayers, ...extractionLayers]),
  };
}

function resolveCleanPlateStatus(
  cleanPlate: LayeredDesignExtractionCleanPlateInput | undefined,
): LayeredDesignExtractionCleanPlateStatus {
  if (cleanPlate?.status) {
    return cleanPlate.status;
  }

  return cleanPlate?.asset || cleanPlate?.assetId
    ? "succeeded"
    : "not_requested";
}

export function createLayeredDesignExtractionDocument(
  params: CreateLayeredDesignExtractionDocumentParams,
): LayeredDesignDocument {
  const createdAt = params.createdAt ?? nowIso();
  const cleanPlateStatus = resolveCleanPlateStatus(params.cleanPlate);
  const sourceAsset: GeneratedDesignAsset = {
    ...copyGeneratedAsset(params.sourceAsset),
    kind: "source_image",
    createdAt: params.sourceAsset.createdAt || createdAt,
  };
  const cleanPlateAsset = params.cleanPlate?.asset
    ? {
        ...copyGeneratedAsset(params.cleanPlate.asset),
        kind: "clean_plate" as const,
        createdAt: params.cleanPlate.asset.createdAt || createdAt,
      }
    : undefined;
  const assets = dedupeGeneratedAssets([
    sourceAsset,
    ...(cleanPlateAsset ? [cleanPlateAsset] : []),
    ...(params.candidates ?? []).flatMap((candidate) => candidate.assets ?? []),
  ]);
  const selectedCandidateCount = (params.candidates ?? []).filter(
    (candidate) => candidate.selected === true,
  ).length;
  const draft = normalizeLayeredDesignDocument({
    id: params.id,
    title: params.title,
    status: "draft",
    canvas: { ...params.canvas },
    layers: [],
    assets,
    extraction: {
      sourceAssetId: sourceAsset.id,
      backgroundLayerId: params.backgroundLayerId,
      candidateSelectionThreshold: params.candidateSelectionThreshold,
      review: {
        status: "pending",
      },
      ...(params.analysis ? { analysis: params.analysis } : {}),
      cleanPlate: {
        status: cleanPlateStatus,
        ...(cleanPlateAsset ? { asset: cleanPlateAsset } : {}),
        ...(params.cleanPlate?.assetId && !cleanPlateAsset
          ? { assetId: params.cleanPlate.assetId }
          : {}),
        ...(params.cleanPlate?.message
          ? { message: params.cleanPlate.message }
          : {}),
      },
      candidates: params.candidates,
    },
    editHistory: [
      {
        id: "extraction-created",
        type: "created",
        actor: "assistant",
        summary: `根据扁平图拆层结果创建 draft；候选层 ${params.candidates?.length ?? 0} 个，显式预选 ${selectedCandidateCount} 个，clean plate 状态：${cleanPlateStatus}。`,
        createdAt,
      },
    ],
    createdAt,
    updatedAt: params.updatedAt ?? createdAt,
  });

  return syncExtractionLayers(draft);
}

export function updateLayeredDesignExtractionSelection(
  documentInput: LayeredDesignDocumentInput | LayeredDesignDocument,
  params: UpdateLayeredDesignExtractionSelectionParams,
): LayeredDesignDocument {
  const document = normalizeLayeredDesignDocument(documentInput);
  if (!document.extraction) {
    throw new Error("文档不存在扁平图拆层上下文");
  }

  const selectedCandidateIds = new Set(params.selectedCandidateIds);
  const editedAt = params.editedAt ?? nowIso();
  const nextDocument = syncExtractionLayers({
    ...document,
    extraction: {
      ...document.extraction,
      review: {
        ...document.extraction.review,
      },
      cleanPlate: { ...document.extraction.cleanPlate },
      candidates: document.extraction.candidates.map((candidate) =>
        copyExtractionCandidate({
          ...candidate,
          selected: selectedCandidateIds.has(candidate.id),
        }),
      ),
    },
  });
  const selectedCount = nextDocument.extraction?.candidates.filter(
    (candidate) => candidate.selected,
  ).length;
  const editRecord: LayerEditRecord = {
    id: params.editId ?? `candidate-selection-${document.editHistory.length + 1}`,
    type: "candidate_selection_updated",
    actor: params.actor ?? "user",
    summary:
      params.summary ??
      `更新拆层候选选择：${selectedCount ?? 0}/${nextDocument.extraction?.candidates.length ?? 0} 个候选层已进入正式图层。`,
    createdAt: editedAt,
  };

  return {
    ...nextDocument,
    preview: nextDocument.preview
      ? {
          ...nextDocument.preview,
          stale: true,
        }
      : undefined,
    editHistory: [...nextDocument.editHistory, editRecord],
    updatedAt: editedAt,
  };
}

export function confirmLayeredDesignExtraction(
  documentInput: LayeredDesignDocumentInput | LayeredDesignDocument,
  params: ConfirmLayeredDesignExtractionParams = {},
): LayeredDesignDocument {
  const document = normalizeLayeredDesignDocument(documentInput);
  if (!document.extraction) {
    throw new Error("文档不存在扁平图拆层上下文");
  }

  if (document.extraction.review.status === "confirmed") {
    return document;
  }

  const editedAt = params.editedAt ?? nowIso();
  const selectedCount = document.extraction.candidates.filter(
    (candidate) => candidate.selected,
  ).length;
  const nextDocument = syncExtractionLayers({
    ...document,
    extraction: {
      ...document.extraction,
      review: {
        status: "confirmed",
        confirmedAt: editedAt,
      },
      cleanPlate: { ...document.extraction.cleanPlate },
      candidates: document.extraction.candidates.map(copyExtractionCandidate),
    },
  });
  const editRecord: LayerEditRecord = {
    id: params.editId ?? `candidate-selection-confirmed-${document.editHistory.length + 1}`,
    type: "candidate_selection_confirmed",
    actor: params.actor ?? "user",
    summary:
      params.summary ??
      `确认拆层候选并进入图层编辑：${selectedCount}/${document.extraction.candidates.length} 个候选层已保留。`,
    createdAt: editedAt,
  };

  return {
    ...nextDocument,
    editHistory: [...nextDocument.editHistory, editRecord],
    updatedAt: editedAt,
  };
}

export function reanalyzeLayeredDesignExtraction(
  documentInput: LayeredDesignDocumentInput | LayeredDesignDocument,
  params: ReanalyzeLayeredDesignExtractionParams = {},
): LayeredDesignDocument {
  const document = normalizeLayeredDesignDocument(documentInput);
  if (!document.extraction) {
    throw new Error("文档不存在扁平图拆层上下文");
  }

  const sourceAsset = document.assets.find(
    (asset) => asset.id === document.extraction?.sourceAssetId,
  );
  if (!sourceAsset) {
    throw new Error("文档缺少扁平图来源资产，无法重新拆层");
  }

  const editedAt = params.editedAt ?? nowIso();
  const refreshed = createLayeredDesignExtractionDocument({
    id: document.id,
    title: document.title,
    canvas: { ...document.canvas },
    sourceAsset,
    analysis: params.analysis,
    candidates: params.candidates,
    cleanPlate: params.cleanPlate,
    candidateSelectionThreshold: document.extraction.candidateSelectionThreshold,
    backgroundLayerId: document.extraction.backgroundLayerId,
    createdAt: document.createdAt,
    updatedAt: editedAt,
  });
  const selectedCount =
    refreshed.extraction?.candidates.filter((candidate) => candidate.selected)
      .length ?? 0;
  const candidateCount = refreshed.extraction?.candidates.length ?? 0;
  const cleanPlateStatus =
    refreshed.extraction?.cleanPlate.status ?? "not_requested";
  const editRecord: LayerEditRecord = {
    id: params.editId ?? `extraction-reanalyzed-${document.editHistory.length + 1}`,
    type: "extraction_reanalyzed",
    actor: params.actor ?? "user",
    summary:
      params.summary ??
      `重新拆层完成：候选层 ${candidateCount} 个，默认保留 ${selectedCount} 个，clean plate 状态：${cleanPlateStatus}。`,
    createdAt: editedAt,
  };

  return {
    ...refreshed,
    status: document.status === "exported" ? "draft" : document.status,
    preview: document.preview
      ? {
          ...document.preview,
          stale: true,
        }
      : undefined,
    editHistory: [...document.editHistory.map(copyEditRecord), editRecord],
    createdAt: document.createdAt,
    updatedAt: editedAt,
  };
}
