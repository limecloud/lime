/**
 * @file Artifact 协议边界
 * @description 统一收口 runtime metadata 中与 artifact 文档载荷、产物路径相关的协议读取
 */

import {
  hasArtifactDocumentMetadata,
  resolveArtifactDocumentPayload,
  resolveArtifactDocumentPreviewText,
  type ArtifactDocumentV1,
} from "@/lib/artifact-document";

interface ResolveArtifactProtocolDocumentPayloadInput {
  content?: string;
  metadata?: Record<string, unknown>;
  previous?: ArtifactDocumentV1 | null;
}

interface ArtifactProtocolFileTarget {
  title: string;
  meta: {
    filePath?: unknown;
    filename?: unknown;
  };
}

function isArtifactProtocolRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").trim();
}

function appendArtifactProtocolPath(
  paths: Set<string>,
  value: unknown,
): void {
  const normalized = normalizeText(value);
  if (!normalized) {
    return;
  }

  const normalizedPath = normalizePath(normalized);
  if (normalizedPath) {
    paths.add(normalizedPath);
  }
}

function appendArtifactProtocolPaths(
  paths: Set<string>,
  value: unknown,
): void {
  if (!Array.isArray(value)) {
    appendArtifactProtocolPath(paths, value);
    return;
  }

  for (const item of value) {
    appendArtifactProtocolPath(paths, item);
  }
}

function collectArtifactProtocolPathsFromValue(
  paths: Set<string>,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactProtocolPathsFromValue(paths, item);
    }
    return;
  }

  if (!isArtifactProtocolRecord(value)) {
    return;
  }

  for (const path of extractArtifactProtocolPaths(value)) {
    paths.add(path);
  }

  for (const nestedValue of Object.values(value)) {
    if (nestedValue && typeof nestedValue === "object") {
      collectArtifactProtocolPathsFromValue(paths, nestedValue);
    }
  }
}

export function hasArtifactProtocolDocumentMetadata(
  metadata?: Record<string, unknown>,
): boolean {
  return hasArtifactDocumentMetadata(metadata);
}

export function resolveArtifactProtocolDocumentPayload(
  input: ResolveArtifactProtocolDocumentPayloadInput,
): ArtifactDocumentV1 | null {
  return resolveArtifactDocumentPayload(input);
}

export function resolveArtifactProtocolPreviewText(
  document: ArtifactDocumentV1,
): string | undefined {
  return resolveArtifactDocumentPreviewText(document);
}

export function extractArtifactProtocolPaths(
  metadata?: Record<string, unknown>,
): string[] {
  if (!metadata) {
    return [];
  }

  const paths = new Set<string>();
  for (const key of [
    "path",
    "file_path",
    "filePath",
    "target_path",
    "targetPath",
    "output_path",
    "outputPath",
    "absolute_path",
    "absolutePath",
    "artifact_path",
    "artifactPath",
    "artifact_paths",
    "artifactPaths",
    "paths",
    "source_file_name",
    "sourceFileName",
  ]) {
    appendArtifactProtocolPaths(paths, metadata[key]);
  }

  return Array.from(paths);
}

export function extractArtifactProtocolPathsFromRecord(
  record?: unknown,
): string[] {
  if (!isArtifactProtocolRecord(record)) {
    return [];
  }

  return extractArtifactProtocolPaths(record);
}

export function extractArtifactProtocolPathsFromValue(
  value?: unknown,
): string[] {
  const paths = new Set<string>();
  collectArtifactProtocolPathsFromValue(paths, value);
  return Array.from(paths);
}

export function resolveArtifactProtocolFilePath(
  artifact: ArtifactProtocolFileTarget,
): string {
  const filePath = normalizeText(artifact.meta.filePath);
  if (filePath) {
    return filePath;
  }

  const filename = normalizeText(artifact.meta.filename);
  if (filename) {
    return filename;
  }

  return artifact.title;
}

export function hasArtifactProtocolMetadata(
  metadata?: Record<string, unknown>,
): boolean {
  return (
    hasArtifactProtocolDocumentMetadata(metadata) ||
    extractArtifactProtocolPaths(metadata).length > 0
  );
}
