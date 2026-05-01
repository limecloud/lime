import type { MessagePathReference } from "../types";

export const PATH_REFERENCE_DRAG_MIME = "application/x-lime-path-reference";
const REMEMBERED_PATH_DRAG_TTL_MS = 10_000;

interface PathReferenceInput {
  path: string;
  name?: string | null;
  isDir?: boolean;
  size?: number | null;
  mimeType?: string | null;
  source?: MessagePathReference["source"];
}

let rememberedPathDrag: {
  expiresAt: number;
  references: MessagePathReference[];
} | null = null;
let rememberedPathDragClearTimer: ReturnType<typeof setTimeout> | null = null;

function normalizePath(value: string): string {
  return value.trim();
}

export function extractPathName(path: string): string {
  const normalized = normalizePath(path).replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) || normalized || "本地路径";
}

export function createPathReference(
  input: PathReferenceInput,
): MessagePathReference | null {
  const path = normalizePath(input.path);
  if (!path) {
    return null;
  }

  const isDir = Boolean(input.isDir);
  return {
    id: `${isDir ? "dir" : "file"}:${path}`,
    path,
    name: input.name?.trim() || extractPathName(path),
    isDir,
    size: input.size ?? null,
    mimeType: input.mimeType ?? null,
    source: input.source,
  };
}

export function mergePathReferences(
  current: MessagePathReference[],
  incoming: MessagePathReference[],
): MessagePathReference[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

export function serializePathReferencesForDrag(
  references: MessagePathReference[],
): string {
  return JSON.stringify(references);
}

export function rememberPathReferencesForDrag(
  references: MessagePathReference[],
): void {
  if (rememberedPathDragClearTimer) {
    clearTimeout(rememberedPathDragClearTimer);
    rememberedPathDragClearTimer = null;
  }
  rememberedPathDrag = {
    expiresAt: Date.now() + REMEMBERED_PATH_DRAG_TTL_MS,
    references: references.map((reference) => ({ ...reference })),
  };
}

export function clearRememberedPathReferencesForDrag(delayMs = 0): void {
  if (rememberedPathDragClearTimer) {
    clearTimeout(rememberedPathDragClearTimer);
    rememberedPathDragClearTimer = null;
  }

  const clear = () => {
    rememberedPathDrag = null;
    rememberedPathDragClearTimer = null;
  };

  if (delayMs > 0) {
    rememberedPathDragClearTimer = setTimeout(clear, delayMs);
    return;
  }

  clear();
}

function readRememberedPathReferencesForDrag(
  textFallback?: string,
): MessagePathReference[] {
  if (!rememberedPathDrag || rememberedPathDrag.expiresAt < Date.now()) {
    rememberedPathDrag = null;
    return [];
  }

  const normalizedTextFallback = textFallback?.trim();
  if (
    normalizedTextFallback &&
    !rememberedPathDrag.references.some(
      (reference) => reference.path === normalizedTextFallback,
    )
  ) {
    return [];
  }

  return rememberedPathDrag.references.map((reference) => ({ ...reference }));
}

function getDataTransferData(
  dataTransfer: DataTransfer,
  format: string,
): string {
  try {
    return dataTransfer.getData(format);
  } catch {
    return "";
  }
}

export function readCustomPathReferencesFromDataTransfer(
  dataTransfer: DataTransfer,
): MessagePathReference[] {
  const raw = getDataTransferData(dataTransfer, PATH_REFERENCE_DRAG_MIME);
  if (!raw.trim()) {
    return readRememberedPathReferencesForDrag(
      getDataTransferData(dataTransfer, "text/plain"),
    );
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values
      .map((value) => {
        if (typeof value !== "object" || value === null) {
          return null;
        }
        const record = value as Record<string, unknown>;
        return createPathReference({
          path: typeof record.path === "string" ? record.path : "",
          name: typeof record.name === "string" ? record.name : null,
          isDir: record.isDir === true,
          size: typeof record.size === "number" ? record.size : null,
          mimeType:
            typeof record.mimeType === "string" ? record.mimeType : null,
          source: "file_manager",
        });
      })
      .filter((item): item is MessagePathReference => Boolean(item));
  } catch {
    return [];
  }
}

export function readSystemPathReferencesFromFiles(
  files: FileList | File[],
): MessagePathReference[] {
  return Array.from(files)
    .map((file) => {
      const path =
        (file as File & { path?: string }).path || file.webkitRelativePath;
      if (!path?.trim()) {
        return null;
      }
      return createPathReference({
        path,
        name: file.name,
        isDir: false,
        size: file.size,
        mimeType: file.type || null,
        source: "system_drop",
      });
    })
    .filter((item): item is MessagePathReference => Boolean(item));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function buildPathReferenceRequestMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  references: MessagePathReference[],
): Record<string, unknown> | undefined {
  if (references.length === 0) {
    return requestMetadata;
  }

  const fileReferences = references.map((reference) => ({
    path: reference.path,
    name: reference.name,
    is_dir: reference.isDir,
    isDir: reference.isDir,
    size: reference.size ?? null,
    mime_type: reference.mimeType ?? null,
    mimeType: reference.mimeType ?? null,
    source: reference.source || "inputbar_path_chip",
  }));
  const base = requestMetadata || {};
  const harness = asRecord(base.harness) || {};

  return {
    ...base,
    path_references: fileReferences,
    harness: {
      ...harness,
      file_references: fileReferences,
      fileReferences,
    },
  };
}
