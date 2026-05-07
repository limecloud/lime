import {
  createLayeredDesignExtractionDocument,
  type CreateLayeredDesignExtractionDocumentParams,
} from "./extraction";
import type {
  GeneratedDesignAsset,
  LayeredDesignDocument,
  LayeredDesignExtractionAnalysisInput,
  LayeredDesignExtractionCandidateInput,
  LayeredDesignExtractionCleanPlateInput,
} from "./types";

export interface LayeredDesignFlatImageSource {
  src: string;
  width: number;
  height: number;
  fileName?: string;
  mimeType?: string;
  hasAlpha?: boolean;
  assetId?: string;
  createdAt?: string;
}

export interface CreateLayeredDesignFlatImageDraftDocumentParams {
  id?: string;
  title?: string;
  image: LayeredDesignFlatImageSource;
  analysis?: LayeredDesignExtractionAnalysisInput;
  candidates?: LayeredDesignExtractionCandidateInput[];
  cleanPlate?: LayeredDesignExtractionCleanPlateInput;
  candidateSelectionThreshold?: number;
  createdAt?: string;
  updatedAt?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function inferTitle(
  explicitTitle: string | undefined,
  image: LayeredDesignFlatImageSource,
): string {
  const title = explicitTitle?.trim();
  if (title) {
    return title;
  }

  const fromFileName = stripExtension(image.fileName?.trim() ?? "");
  if (fromFileName) {
    return fromFileName;
  }

  return "上传扁平图";
}

function createSlug(value: string): string {
  const asciiSlug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  if (asciiSlug) {
    return asciiSlug;
  }

  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return `flat-image-${hash.toString(16)}`;
}

function inferDocumentId(
  explicitId: string | undefined,
  title: string,
  image: LayeredDesignFlatImageSource,
): string {
  const id = explicitId?.trim();
  if (id) {
    return id;
  }

  const fromFileName = stripExtension(image.fileName?.trim() ?? "");
  if (fromFileName) {
    return createSlug(fromFileName);
  }

  return createSlug(title);
}

function createSourceAsset(
  documentId: string,
  image: LayeredDesignFlatImageSource,
  createdAt: string,
): GeneratedDesignAsset {
  return {
    id: image.assetId?.trim() || `${documentId}-source-image`,
    kind: "source_image",
    src: image.src,
    width: normalizePositiveInteger(image.width, 1),
    height: normalizePositiveInteger(image.height, 1),
    hasAlpha: image.hasAlpha ?? false,
    createdAt: image.createdAt ?? createdAt,
    ...(image.mimeType ? { params: { mimeType: image.mimeType } } : {}),
  };
}

function createExtractionParams(
  params: CreateLayeredDesignFlatImageDraftDocumentParams,
): CreateLayeredDesignExtractionDocumentParams {
  const createdAt = params.createdAt ?? nowIso();
  const title = inferTitle(params.title, params.image);
  const id = inferDocumentId(params.id, title, params.image);
  const sourceAsset = createSourceAsset(id, params.image, createdAt);

  return {
    id,
    title,
    canvas: {
      width: normalizePositiveInteger(params.image.width, 1),
      height: normalizePositiveInteger(params.image.height, 1),
    },
    sourceAsset,
    analysis: params.analysis,
    candidates: params.candidates,
    cleanPlate: params.cleanPlate,
    candidateSelectionThreshold: params.candidateSelectionThreshold,
    createdAt,
    updatedAt: params.updatedAt ?? createdAt,
  };
}

export function createLayeredDesignFlatImageDraftDocument(
  params: CreateLayeredDesignFlatImageDraftDocumentParams,
): LayeredDesignDocument {
  return createLayeredDesignExtractionDocument(createExtractionParams(params));
}
