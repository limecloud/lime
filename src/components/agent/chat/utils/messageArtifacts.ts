import type {
  Artifact,
  ArtifactMeta,
  ArtifactStatus,
  ArtifactType,
} from "@/lib/artifact/types";
import {
  hasArtifactProtocolDocumentMetadata,
  resolveArtifactProtocolDocumentPayload,
  resolveArtifactProtocolFilePath,
  resolveArtifactProtocolPreviewText,
} from "@/lib/artifact-protocol";
import type {
  ArtifactWriteMetadata,
  ArtifactWritePhase,
  Message,
  WriteArtifactContext,
} from "../types";

const MARKDOWN_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "rst",
  "adoc",
]);
const MERMAID_EXTENSIONS = new Set(["mmd", "mermaid"]);
const REACT_EXTENSIONS = new Set(["jsx", "tsx"]);

const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "svg",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

const ARTIFACT_TYPE_ALIASES: Record<string, ArtifactType> = {
  artifact_document: "document",
  artifact_document_v1: "document",
  code: "code",
  document: "document",
  draft: "document",
  html: "html",
  markdown: "document",
  md: "document",
  mermaid: "mermaid",
  react: "react",
  research: "document",
  social_post: "document",
  svg: "svg",
  text: "document",
};
const ARTIFACT_PREVIEW_MAX_CHARS = 240;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

function fileNameFromPath(path: string): string {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

function extensionFromPath(path: string): string {
  const fileName = fileNameFromPath(path);
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return "";
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function readStringValue(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePreviewText(
  value: string,
  maxChars = ARTIFACT_PREVIEW_MAX_CHARS,
): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trimEnd()}…`;
}

export function resolveArtifactWritePhase(
  artifact: Pick<Artifact, "status" | "meta">,
): ArtifactWritePhase | null {
  const explicitPhase =
    typeof artifact.meta.writePhase === "string"
      ? (artifact.meta.writePhase as ArtifactWritePhase)
      : null;
  if (explicitPhase) {
    return explicitPhase;
  }

  switch (artifact.status) {
    case "pending":
      return "preparing";
    case "streaming":
      return "streaming";
    case "complete":
      return "completed";
    case "error":
      return "failed";
    default:
      return null;
  }
}

export function formatArtifactWritePhaseLabel(
  phase: ArtifactWritePhase | null,
): string {
  switch (phase) {
    case "preparing":
      return "准备写入";
    case "streaming":
      return "正在写入";
    case "persisted":
      return "已落盘";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "待处理";
  }
}

export function resolveArtifactPreviewText(
  artifact: Pick<Artifact, "content" | "meta">,
  maxChars = ARTIFACT_PREVIEW_MAX_CHARS,
): string | undefined {
  const previewCandidate =
    typeof artifact.meta.previewText === "string" && artifact.meta.previewText.trim()
      ? artifact.meta.previewText
      : artifact.content;

  if (typeof previewCandidate !== "string" || !previewCandidate.trim()) {
    return undefined;
  }

  return normalizePreviewText(previewCandidate, maxChars);
}

export function findMessageArtifact(
  message: Pick<Message, "artifacts">,
  options: {
    artifactId?: string;
    filePath?: string;
  },
): Artifact | undefined {
  const artifacts = message.artifacts || [];
  const normalizedPath = options.filePath ? normalizePath(options.filePath) : null;

  return artifacts.find((artifact) => {
    if (options.artifactId && artifact.id === options.artifactId) {
      return true;
    }

    if (!normalizedPath) {
      return false;
    }

    const artifactPath = normalizePath(resolveArtifactProtocolFilePath(artifact));
    return artifactPath === normalizedPath;
  });
}

export function resolveArtifactTypeFromFile(
  filePath: string,
  metadata?: Record<string, unknown>,
  content?: string,
): ArtifactType {
  if (
    resolveArtifactProtocolDocumentPayload({
      content,
      metadata,
    }) ||
    hasArtifactProtocolDocumentMetadata(metadata)
  ) {
    return "document";
  }

  const explicitType =
    readStringValue(metadata, "artifact_type") ||
    readStringValue(metadata, "type") ||
    readStringValue(metadata, "kind");
  const aliasedType = explicitType
    ? ARTIFACT_TYPE_ALIASES[explicitType.toLowerCase()]
    : undefined;
  if (aliasedType) {
    return aliasedType;
  }

  const extension = extensionFromPath(filePath);
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "document";
  }
  if (extension === "html" || extension === "htm") {
    return "html";
  }
  if (extension === "svg") {
    return "svg";
  }
  if (MERMAID_EXTENSIONS.has(extension)) {
    return "mermaid";
  }
  if (REACT_EXTENSIONS.has(extension)) {
    return "react";
  }
  return "code";
}

export function resolveArtifactLanguageFromFile(filePath: string): string | undefined {
  const extension = extensionFromPath(filePath);
  if (!extension) {
    return undefined;
  }
  return CODE_LANGUAGE_BY_EXTENSION[extension] || extension;
}

export function resolveDefaultArtifactViewMode(
  artifact: Pick<Artifact, "type" | "meta">,
): "source" | "preview" {
  if (artifact.type === "document") {
    return "preview";
  }
  if (
    artifact.type === "html" ||
    artifact.type === "svg" ||
    artifact.type === "mermaid" ||
    artifact.type === "react"
  ) {
    return "preview";
  }
  if (
    artifact.type === "code" &&
    ["html", "svg"].includes(
      String(artifact.meta.language || "").trim().toLowerCase(),
    )
  ) {
    return "preview";
  }
  return "source";
}

export interface BuildArtifactInput {
  filePath: string;
  content: string;
  context?: WriteArtifactContext;
}

export function buildArtifactFromWrite({
  filePath,
  content,
  context,
}: BuildArtifactInput): Artifact {
  const normalizedPath = normalizePath(filePath);
  const title = fileNameFromPath(normalizedPath);
  const now = Date.now();
  const metadata = context?.metadata;
  const existingMeta =
    context?.artifact?.meta && typeof context.artifact.meta === "object"
      ? (context.artifact.meta as ArtifactWriteMetadata)
      : undefined;
  const existingArtifactDocument = resolveArtifactProtocolDocumentPayload({
    metadata: existingMeta,
  });
  const artifactDocument = resolveArtifactProtocolDocumentPayload({
    content,
    metadata,
    previous: existingArtifactDocument,
  });
  const type = resolveArtifactTypeFromFile(normalizedPath, metadata, content);
  const language =
    artifactDocument
      ? "json"
      : type === "code" || type === "document"
      ? resolveArtifactLanguageFromFile(normalizedPath)
      : undefined;
  const previewCandidate =
    artifactDocument
      ? resolveArtifactProtocolPreviewText(artifactDocument)
      : typeof metadata?.previewText === "string" && metadata.previewText.trim()
        ? metadata.previewText
        : typeof content === "string" && content.trim()
          ? content
          : undefined;
  const previewText = previewCandidate
    ? normalizePreviewText(previewCandidate)
    : undefined;
  const baseMeta: ArtifactMeta = {
    ...(existingMeta || {}),
    ...(metadata || {}),
    ...(language ? { language } : {}),
    ...(previewText &&
    (!(
      typeof metadata?.previewText === "string" && metadata.previewText.trim()
    ) ||
      Boolean(artifactDocument))
      ? { previewText }
      : {}),
    filePath: normalizedPath,
    filename: title,
    source: context?.source,
    sourceMessageId: context?.sourceMessageId,
    ...(artifactDocument
      ? {
          artifactSchema: artifactDocument.schemaVersion,
          artifactKind: artifactDocument.kind,
          artifactDocument,
          artifactTitle: artifactDocument.title,
        }
      : {}),
  };

  return {
    id:
      context?.artifactId ||
      context?.artifact?.id ||
      `artifact:${context?.sourceMessageId || "session"}:${normalizedPath}`,
    type,
    title,
    content,
    status: context?.status || "complete",
    meta: baseMeta,
    position: context?.artifact?.position || { start: 0, end: content.length },
    createdAt: context?.artifact?.createdAt || now,
    updatedAt: now,
    error: context?.artifact?.error,
  };
}

export function upsertMessageArtifact(message: Message, artifact: Artifact): Message {
  const currentArtifacts = message.artifacts || [];
  const existingIndex = currentArtifacts.findIndex((item) => item.id === artifact.id);

  if (existingIndex < 0) {
    return {
      ...message,
      artifacts: [...currentArtifacts, artifact],
    };
  }

  const nextArtifacts = [...currentArtifacts];
  nextArtifacts[existingIndex] = {
    ...nextArtifacts[existingIndex],
    ...artifact,
    meta: {
      ...nextArtifacts[existingIndex].meta,
      ...artifact.meta,
    },
    updatedAt: artifact.updatedAt,
  };

  return {
    ...message,
    artifacts: nextArtifacts,
  };
}

export function updateMessageArtifactsStatus(
  message: Message,
  nextStatus: ArtifactStatus,
): Message {
  if (!message.artifacts || message.artifacts.length === 0) {
    return message;
  }

  const nextArtifacts = message.artifacts.map((artifact) =>
    artifact.status === "streaming" || artifact.status === "pending"
      ? {
          ...artifact,
          status: nextStatus,
          meta: {
            ...artifact.meta,
            writePhase:
              nextStatus === "complete"
                ? "completed"
                : nextStatus === "error"
                  ? "failed"
                  : artifact.meta.writePhase,
          },
          updatedAt: Date.now(),
        }
      : artifact,
  );

  return {
    ...message,
    artifacts: nextArtifacts,
  };
}

export function mergeArtifacts(artifacts: Artifact[]): Artifact[] {
  const merged = new Map<string, Artifact>();

  for (const artifact of artifacts) {
    const existing = merged.get(artifact.id);
    if (!existing) {
      merged.set(artifact.id, artifact);
      continue;
    }

    merged.set(artifact.id, {
      ...existing,
      ...artifact,
      meta: {
        ...existing.meta,
        ...artifact.meta,
      },
      updatedAt: Math.max(existing.updatedAt, artifact.updatedAt),
    });
  }

  return Array.from(merged.values()).sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt - right.updatedAt;
    }
    return left.createdAt - right.createdAt;
  });
}
