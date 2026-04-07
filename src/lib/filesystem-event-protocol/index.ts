/**
 * @file Filesystem Event 协议边界
 * @description 统一收口 runtime metadata 中与通用文件/目录事件相关的路径与位置线索读取
 */

function isFilesystemEventRecord(
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

function appendFilesystemEventPath(paths: Set<string>, value: unknown): void {
  const normalized = normalizeText(value);
  if (!normalized) {
    return;
  }

  const normalizedPath = normalizePath(normalized);
  if (normalizedPath) {
    paths.add(normalizedPath);
  }
}

function appendFilesystemEventPaths(paths: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) {
    appendFilesystemEventPath(paths, value);
    return;
  }

  for (const item of value) {
    appendFilesystemEventPath(paths, item);
  }
}

function collectFilesystemEventPathsFromValue(
  paths: Set<string>,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFilesystemEventPathsFromValue(paths, item);
    }
    return;
  }

  if (!isFilesystemEventRecord(value)) {
    return;
  }

  for (const path of extractFilesystemEventPaths(value)) {
    paths.add(path);
  }

  for (const nestedValue of Object.values(value)) {
    if (nestedValue && typeof nestedValue === "object") {
      collectFilesystemEventPathsFromValue(paths, nestedValue);
    }
  }
}

function collectFilesystemEventLocationHintsFromValue(
  paths: Set<string>,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFilesystemEventLocationHintsFromValue(paths, item);
    }
    return;
  }

  if (!isFilesystemEventRecord(value)) {
    return;
  }

  for (const path of extractFilesystemEventLocationHints(value)) {
    paths.add(path);
  }

  for (const nestedValue of Object.values(value)) {
    if (nestedValue && typeof nestedValue === "object") {
      collectFilesystemEventLocationHintsFromValue(paths, nestedValue);
    }
  }
}

export function extractFilesystemEventPaths(
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
    "file_name",
    "fileName",
    "filename",
    "target_path",
    "targetPath",
    "output_path",
    "outputPath",
    "absolute_path",
    "absolutePath",
    "new_path",
    "newPath",
    "paths",
    "files",
  ]) {
    appendFilesystemEventPaths(paths, metadata[key]);
  }

  return Array.from(paths);
}

export function extractFilesystemEventPathsFromRecord(
  record?: unknown,
): string[] {
  if (!isFilesystemEventRecord(record)) {
    return [];
  }

  return extractFilesystemEventPaths(record);
}

export function extractFilesystemEventPathsFromValue(
  value?: unknown,
): string[] {
  const paths = new Set<string>();
  collectFilesystemEventPathsFromValue(paths, value);
  return Array.from(paths);
}

export function extractFilesystemEventLocationHints(
  metadata?: Record<string, unknown>,
): string[] {
  if (!metadata) {
    return [];
  }

  const paths = new Set<string>();
  for (const key of ["directory", "cwd", "output_file", "offload_file"]) {
    appendFilesystemEventPaths(paths, metadata[key]);
  }

  return Array.from(paths);
}

export function extractFilesystemEventLocationHintsFromRecord(
  record?: unknown,
): string[] {
  if (!isFilesystemEventRecord(record)) {
    return [];
  }

  return extractFilesystemEventLocationHints(record);
}

export function extractFilesystemEventLocationHintsFromValue(
  value?: unknown,
): string[] {
  const paths = new Set<string>();
  collectFilesystemEventLocationHintsFromValue(paths, value);
  return Array.from(paths);
}
