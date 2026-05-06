import type { Artifact, ArtifactMeta } from "@/lib/artifact/types";
import { normalizeLayeredDesignDocument } from "./document";
import {
  createLayeredDesignExtractionDocument,
  type CreateLayeredDesignExtractionDocumentParams,
} from "./extraction";
import {
  createLayeredDesignFlatImageDraftDocument,
  type CreateLayeredDesignFlatImageDraftDocumentParams,
} from "./flatImage";
import { createLayeredDesignSeedDocument } from "./planner";
import type {
  LayeredDesignDocument,
  LayeredDesignDocumentInput,
} from "./types";

export type LayeredDesignArtifactSource =
  | "layered-design-document"
  | "layered-design-seed"
  | "layered-design-extraction";

export interface CreateLayeredDesignArtifactOptions {
  artifactId?: string;
  artifactTitle?: string;
  timestamp?: number;
  meta?: ArtifactMeta;
  source?: LayeredDesignArtifactSource;
}

export interface CreateLayeredDesignArtifactFromPromptOptions
  extends Omit<CreateLayeredDesignArtifactOptions, "source"> {
  id?: string;
  title?: string;
  documentCreatedAt?: string;
}

export interface CreateLayeredDesignArtifactFromExtractionOptions
  extends Omit<CreateLayeredDesignArtifactOptions, "source">,
    CreateLayeredDesignExtractionDocumentParams {
  documentCreatedAt?: string;
}

export interface CreateLayeredDesignArtifactFromFlatImageOptions
  extends Omit<CreateLayeredDesignArtifactOptions, "source">,
    CreateLayeredDesignFlatImageDraftDocumentParams {
  documentCreatedAt?: string;
}

function createSafeDesignFilename(documentId: string): string {
  const safeId =
    documentId.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") ||
    "layered-design";

  return `${safeId}.design.json`;
}

function toArtifactTimestamp(
  document: LayeredDesignDocument,
  timestamp?: number,
): number {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }

  const parsedUpdatedAt = Date.parse(document.updatedAt);
  if (Number.isFinite(parsedUpdatedAt)) {
    return parsedUpdatedAt;
  }

  const parsedCreatedAt = Date.parse(document.createdAt);
  return Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now();
}

export function createLayeredDesignArtifact(
  documentInput: LayeredDesignDocumentInput | LayeredDesignDocument,
  options: CreateLayeredDesignArtifactOptions = {},
): Artifact {
  const document = normalizeLayeredDesignDocument(documentInput);
  const content = JSON.stringify(document, null, 2);
  const timestamp = toArtifactTimestamp(document, options.timestamp);
  const source = options.source ?? "layered-design-document";

  return {
    id: options.artifactId ?? `artifact-${document.id}`,
    type: "canvas:design",
    title: options.artifactTitle?.trim() || document.title,
    content,
    status: "complete",
    meta: {
      ...options.meta,
      filename:
        typeof options.meta?.filename === "string"
          ? options.meta.filename
          : createSafeDesignFilename(document.id),
      platform: "layered-design",
      schemaVersion: document.schemaVersion,
      designId: document.id,
      source,
    },
    position: { start: 0, end: content.length },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createLayeredDesignArtifactFromPrompt(
  prompt: string,
  options: CreateLayeredDesignArtifactFromPromptOptions = {},
): Artifact {
  const { id, title, documentCreatedAt, ...artifactOptions } = options;
  const document = createLayeredDesignSeedDocument({
    prompt,
    id,
    title,
    createdAt: documentCreatedAt,
  });

  return createLayeredDesignArtifact(document, {
    ...artifactOptions,
    source: "layered-design-seed",
  });
}

export function createLayeredDesignArtifactFromExtraction(
  options: CreateLayeredDesignArtifactFromExtractionOptions,
): Artifact {
  const { documentCreatedAt, ...documentOptions } = options;
  const document = createLayeredDesignExtractionDocument({
    ...documentOptions,
    createdAt: documentCreatedAt ?? documentOptions.createdAt,
  });

  return createLayeredDesignArtifact(document, {
    ...options,
    source: "layered-design-extraction",
  });
}

export function createLayeredDesignArtifactFromFlatImage(
  options: CreateLayeredDesignArtifactFromFlatImageOptions,
): Artifact {
  const { documentCreatedAt, ...documentOptions } = options;
  const document = createLayeredDesignFlatImageDraftDocument({
    ...documentOptions,
    createdAt: documentCreatedAt ?? documentOptions.createdAt,
  });

  return createLayeredDesignArtifact(document, {
    ...options,
    source: "layered-design-extraction",
  });
}
