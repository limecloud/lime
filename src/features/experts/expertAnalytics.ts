import type { ExpertCatalogEvent } from "./types";

const EXPERT_ANALYTICS_QUEUE_STORAGE_KEY = "lime:expert-analytics-queue:v1";
const MAX_EXPERT_ANALYTICS_QUEUE_SIZE = 100;

const SENSITIVE_EVENT_KEYS = new Set([
  "prompt",
  "prompts",
  "message",
  "messages",
  "response",
  "assistantresponse",
  "assistantcontent",
  "usercontent",
  "filecontent",
  "memory",
  "privatememory",
  "conversation",
  "conversations",
]);

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\-. ]/g, "");
}

function sanitizeMetadata(
  metadata: ExpertCatalogEvent["metadata"],
): Record<string, string> | undefined {
  if (!metadata) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const trimmedKey = key.trim();
    if (!trimmedKey || SENSITIVE_EVENT_KEYS.has(normalizeKey(trimmedKey))) {
      continue;
    }
    const trimmedValue = String(value ?? "").trim();
    if (!trimmedValue) {
      continue;
    }
    result[trimmedKey.slice(0, 64)] = trimmedValue.slice(0, 256);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeExpertCatalogEvent(
  event: ExpertCatalogEvent,
): ExpertCatalogEvent | null {
  const expertId = event.expertId.trim();
  const releaseId = event.releaseId.trim();
  const sourceSurface = event.sourceSurface.trim();
  if (!expertId || !releaseId || !event.eventName || !sourceSurface) {
    return null;
  }
  return {
    expertId,
    releaseId,
    eventName: event.eventName,
    sourceSurface,
    catalogVersion: event.catalogVersion?.trim() || undefined,
    clientVersion: event.clientVersion?.trim() || undefined,
    locale: event.locale?.trim() || undefined,
    sessionId: event.sessionId?.trim() || undefined,
    occurredAt: event.occurredAt?.trim() || new Date().toISOString(),
    metadata: sanitizeMetadata(event.metadata),
  };
}

function readQueuedExpertCatalogEvents(): ExpertCatalogEvent[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(EXPERT_ANALYTICS_QUEUE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizeExpertCatalogEvent(item as ExpertCatalogEvent))
      .filter((item): item is ExpertCatalogEvent => Boolean(item));
  } catch {
    return [];
  }
}

function saveQueuedExpertCatalogEvents(events: ExpertCatalogEvent[]) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = events
    .map((item) => normalizeExpertCatalogEvent(item))
    .filter((item): item is ExpertCatalogEvent => Boolean(item))
    .slice(-MAX_EXPERT_ANALYTICS_QUEUE_SIZE);
  if (normalized.length === 0) {
    window.localStorage.removeItem(EXPERT_ANALYTICS_QUEUE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    EXPERT_ANALYTICS_QUEUE_STORAGE_KEY,
    JSON.stringify(normalized),
  );
}

export function queueExpertCatalogEvent(event: ExpertCatalogEvent) {
  const normalized = normalizeExpertCatalogEvent(event);
  if (!normalized) {
    return;
  }
  saveQueuedExpertCatalogEvents([
    ...readQueuedExpertCatalogEvents(),
    normalized,
  ]);
}

export async function recordExpertCatalogEvent(event: ExpertCatalogEvent) {
  queueExpertCatalogEvent(event);
}

export const expertAnalyticsStorageKeys = {
  queue: EXPERT_ANALYTICS_QUEUE_STORAGE_KEY,
} as const;
