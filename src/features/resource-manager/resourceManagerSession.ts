import { convertLocalFileSrc } from "@/lib/api/fileSystem";
import type {
  OpenResourceManagerInput,
  ResourceManagerItem,
  ResourceManagerItemInput,
  ResourceManagerKind,
  ResourceManagerSession,
  ResourceManagerSourceContext,
  ResourceManagerSourceContextKind,
} from "./types";
import {
  getResourceFormatInfo,
  inferResourceKindFromMime,
} from "./resourceFormatCatalog";

const RESOURCE_MANAGER_STORAGE_PREFIX = "lime:resource-manager:session:";
export const RESOURCE_MANAGER_ACTIVE_SESSION_KEY =
  "lime:resource-manager:active-session";
export const RESOURCE_MANAGER_SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const PASSTHROUGH_SRC_PREFIXES = [
  "data:",
  "http://",
  "https://",
  "blob:",
  "asset:",
  "file:",
];

const SOURCE_CONTEXT_KINDS = new Set<ResourceManagerSourceContextKind>([
  "chat",
  "image_task",
  "project_resource",
  "browser_saved_content",
  "local_file",
  "external",
]);
const SOURCE_CONTEXT_TEXT_FIELDS: Array<
  keyof Omit<ResourceManagerSourceContext, "kind">
> = [
  "projectId",
  "contentId",
  "taskId",
  "outputId",
  "messageId",
  "threadId",
  "artifactId",
  "originUrl",
  "markdownRelativePath",
  "sourcePage",
  "resourceFolderId",
  "resourceCategory",
];

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function now(): number {
  return Date.now();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeResourceManagerSourceContext(
  value: unknown,
): ResourceManagerSourceContext | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const kind = normalizeOptionalText(value.kind);
  if (
    !kind ||
    !SOURCE_CONTEXT_KINDS.has(kind as ResourceManagerSourceContextKind)
  ) {
    return null;
  }

  const context: ResourceManagerSourceContext = {
    kind: kind as ResourceManagerSourceContextKind,
  };

  SOURCE_CONTEXT_TEXT_FIELDS.forEach((field) => {
    const normalized = normalizeOptionalText(value[field]);
    if (normalized) {
      context[field] = normalized;
    }
  });

  return context;
}

function cloneSourceContext(
  context: ResourceManagerSourceContext | null | undefined,
): ResourceManagerSourceContext | null {
  return context ? { ...context } : null;
}

export function inferResourceManagerKind(params: {
  kind?: ResourceManagerKind | null;
  src?: string | null;
  filePath?: string | null;
  title?: string | null;
  mimeType?: string | null;
  content?: string | null;
}): ResourceManagerKind {
  if (params.kind) return params.kind;

  const format = getResourceFormatInfo(params);
  if (format) return format.kind;

  const mimeKind = inferResourceKindFromMime(params.mimeType);
  if (mimeKind) return mimeKind;

  if (typeof params.content === "string") return "markdown";
  return "unknown";
}

function createResourceManagerSessionId(): string {
  const cryptoLike = globalThis.crypto;
  if (typeof cryptoLike?.randomUUID === "function") {
    return `resource-${cryptoLike.randomUUID()}`;
  }

  return `resource-${now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeResourceManagerSrc(
  src?: string | null,
): string | null {
  const normalized = src?.trim();
  if (!normalized) {
    return null;
  }

  if (
    PASSTHROUGH_SRC_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return normalized;
  }

  return convertLocalFileSrc(normalized);
}

function normalizeResourceManagerItems(
  items: ResourceManagerItemInput[],
  sessionSourceContext?: ResourceManagerSourceContext | null,
): ResourceManagerItem[] {
  return items
    .map((item, index): ResourceManagerItem | null => {
      const src =
        normalizeResourceManagerSrc(item.src) ??
        normalizeResourceManagerSrc(item.filePath) ??
        null;
      const content = typeof item.content === "string" ? item.content : null;
      const filePath = item.filePath?.trim() || null;
      const title = item.title?.trim() || null;
      const kind = inferResourceManagerKind({
        kind: item.kind,
        src: item.src,
        filePath,
        title,
        mimeType: item.mimeType,
        content,
      });

      if (!src && !content && !filePath) {
        return null;
      }

      const sourceContext =
        normalizeResourceManagerSourceContext(item.sourceContext) ??
        cloneSourceContext(sessionSourceContext);

      return {
        id: item.id?.trim() || `resource-item-${index + 1}`,
        kind,
        src,
        filePath,
        title,
        description: item.description?.trim() || null,
        content,
        mimeType: item.mimeType?.trim() || null,
        size: typeof item.size === "number" ? item.size : null,
        metadata: item.metadata,
        sourceContext,
      };
    })
    .filter((item): item is ResourceManagerItem => Boolean(item));
}

export function clampResourceManagerIndex(
  index: number,
  length: number,
): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), length - 1);
}

export function buildResourceManagerSession(
  params: OpenResourceManagerInput,
): ResourceManagerSession | null {
  const sourceContext = normalizeResourceManagerSourceContext(
    params.sourceContext,
  );
  const items = normalizeResourceManagerItems(params.items, sourceContext);
  if (items.length === 0) {
    return null;
  }

  return {
    id: createResourceManagerSessionId(),
    items,
    initialIndex: clampResourceManagerIndex(
      params.initialIndex ?? 0,
      items.length,
    ),
    sourceLabel: params.sourceLabel?.trim() || null,
    sourceContext,
    createdAt: now(),
  };
}

export function getResourceManagerSessionStorageKey(sessionId: string): string {
  return `${RESOURCE_MANAGER_STORAGE_PREFIX}${sessionId}`;
}

export function writeResourceManagerSession(
  session: ResourceManagerSession,
): void {
  const storage = getStorage();
  if (!storage) return;

  cleanupExpiredResourceManagerSessions(storage);
  storage.setItem(
    getResourceManagerSessionStorageKey(session.id),
    JSON.stringify(session),
  );
  storage.setItem(RESOURCE_MANAGER_ACTIVE_SESSION_KEY, session.id);
}

function normalizeStoredResourceManagerSession(
  session: ResourceManagerSession,
): ResourceManagerSession {
  const sourceContext = normalizeResourceManagerSourceContext(
    session.sourceContext,
  );
  const items = session.items.map((item) => ({
    ...item,
    sourceContext:
      normalizeResourceManagerSourceContext(item.sourceContext) ??
      cloneSourceContext(sourceContext),
  }));

  return {
    ...session,
    items,
    sourceContext,
    initialIndex: clampResourceManagerIndex(session.initialIndex, items.length),
  };
}

function isResourceManagerSession(
  value: unknown,
): value is ResourceManagerSession {
  if (!isPlainObject(value)) return false;

  return (
    typeof value.id === "string" &&
    Array.isArray(value.items) &&
    typeof value.initialIndex === "number" &&
    typeof value.createdAt === "number"
  );
}

export function readResourceManagerSession(
  sessionId: string | null | undefined,
): ResourceManagerSession | null {
  const normalizedSessionId = sessionId?.trim();
  const storage = getStorage();
  if (!normalizedSessionId || !storage) return null;

  const storageKey = getResourceManagerSessionStorageKey(normalizedSessionId);
  const raw = storage.getItem(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isResourceManagerSession(parsed)) {
      storage.removeItem(storageKey);
      return null;
    }

    if (now() - parsed.createdAt > RESOURCE_MANAGER_SESSION_TTL_MS) {
      storage.removeItem(storageKey);
      return null;
    }

    return normalizeStoredResourceManagerSession(parsed);
  } catch {
    storage.removeItem(storageKey);
    return null;
  }
}

function cleanupExpiredResourceManagerSessions(storage = getStorage()): void {
  if (!storage) return;

  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter((key): key is string =>
    Boolean(key?.startsWith(RESOURCE_MANAGER_STORAGE_PREFIX)),
  );

  keys.forEach((key) => {
    const raw = storage.getItem(key);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as { createdAt?: unknown };
      if (
        typeof parsed.createdAt !== "number" ||
        now() - parsed.createdAt > RESOURCE_MANAGER_SESSION_TTL_MS
      ) {
        storage.removeItem(key);
      }
    } catch {
      storage.removeItem(key);
    }
  });
}
