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

function splitArtifactProtocolPath(value: string): {
  normalized: string;
  isAbsolute: boolean;
  segments: string[];
} {
  const normalized = normalizePath(value);
  const isAbsolute =
    normalized.startsWith("/") ||
    normalized.startsWith("~/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith("//");
  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");

  return {
    normalized,
    isAbsolute,
    segments,
  };
}

function hasSameTrailingSegments(left: string[], right: string[]): boolean {
  const minLength = Math.min(left.length, right.length);
  for (let index = 1; index <= minLength; index += 1) {
    if (left[left.length - index] !== right[right.length - index]) {
      return false;
    }
  }
  return minLength > 0;
}

function appendArtifactProtocolPath(paths: Set<string>, value: unknown): void {
  const normalized = normalizeText(value);
  if (!normalized) {
    return;
  }

  const normalizedPath = normalizePath(normalized);
  if (normalizedPath) {
    paths.add(normalizedPath);
  }
}

function appendArtifactProtocolPaths(paths: Set<string>, value: unknown): void {
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

export function normalizeArtifactProtocolPath(value?: string | null): string {
  return typeof value === "string"
    ? splitArtifactProtocolPath(value).normalized
    : "";
}

export function areArtifactProtocolPathsEquivalent(
  left?: string | null,
  right?: string | null,
): boolean {
  const leftPath =
    typeof left === "string" ? splitArtifactProtocolPath(left) : null;
  const rightPath =
    typeof right === "string" ? splitArtifactProtocolPath(right) : null;

  if (
    !leftPath ||
    !rightPath ||
    leftPath.segments.length === 0 ||
    rightPath.segments.length === 0
  ) {
    return false;
  }

  if (leftPath.normalized === rightPath.normalized) {
    return true;
  }

  if (
    leftPath.segments.length === rightPath.segments.length &&
    leftPath.segments.every(
      (segment, index) => segment === rightPath.segments[index],
    )
  ) {
    return true;
  }

  const leftFileName = leftPath.segments[leftPath.segments.length - 1];
  const rightFileName = rightPath.segments[rightPath.segments.length - 1];
  if (leftFileName !== rightFileName) {
    return false;
  }

  if (leftPath.segments.length === 1 || rightPath.segments.length === 1) {
    return true;
  }

  if (leftPath.isAbsolute !== rightPath.isAbsolute) {
    return hasSameTrailingSegments(leftPath.segments, rightPath.segments);
  }

  return false;
}

export function isArtifactProtocolImagePath(value?: string | null): boolean {
  const normalized = normalizeArtifactProtocolPath(value);
  if (!normalized) {
    return false;
  }

  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(normalized);
}

export function resolveArtifactProtocolFilePath(
  artifact: ArtifactProtocolFileTarget,
): string {
  const filePath = normalizeText(artifact.meta.filePath);
  if (filePath) {
    return normalizeArtifactProtocolPath(filePath);
  }

  const filename = normalizeText(artifact.meta.filename);
  if (filename) {
    return normalizeArtifactProtocolPath(filename);
  }

  return normalizeArtifactProtocolPath(artifact.title);
}

export function hasArtifactProtocolMetadata(
  metadata?: Record<string, unknown>,
): boolean {
  return (
    hasArtifactProtocolDocumentMetadata(metadata) ||
    extractArtifactProtocolPaths(metadata).length > 0
  );
}
