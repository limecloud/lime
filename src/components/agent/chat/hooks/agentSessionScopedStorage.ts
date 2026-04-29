import { normalizeLegacyThreadItems } from "@/lib/api/agentTextNormalization";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import { filterConversationThreadItems } from "../utils/threadTimelineView";
import { normalizeHistoryMessages } from "./agentChatHistory";
import {
  loadPersisted,
  loadTransient,
  savePersisted,
  saveTransient,
} from "./agentChatStorage";
import { getScopedStorageKey } from "./agentChatShared";

export interface AgentSessionScopedKeys {
  currentSessionKey: string;
  messagesKey: string;
  persistedSessionKey: string;
  sessionSnapshotsKey: string;
  turnsKey: string;
  itemsKey: string;
  currentTurnKey: string;
}

export interface AgentSessionCachedSnapshot {
  messages: Message[];
  threadTurns: AgentThreadTurn[];
  threadItems: AgentThreadItem[];
  currentTurnId: string | null;
  cacheMetadata?: AgentSessionCachedSnapshotMetadata;
}

export interface AgentSessionCachedSnapshotMetadata {
  storageKind: "transient" | "persisted";
  freshness: "fresh" | "stale";
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  staleUntil: number;
  sessionUpdatedAt: number | null;
  messagesCount: number | null;
  historyTruncated: boolean;
}

interface AgentSessionCachedSnapshotRecord extends Omit<
  AgentSessionCachedSnapshot,
  "cacheMetadata"
> {
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  staleUntil: number;
  sessionUpdatedAt: number | null;
  messagesCount: number | null;
  historyTruncated: boolean;
}

const MAX_CACHED_SESSION_SNAPSHOTS = 12;
const MAX_PERSISTED_CACHED_SESSION_SNAPSHOTS = 8;
const MAX_CACHED_SESSION_MESSAGES = 32;
const MAX_CACHED_SESSION_TURNS = 24;
const MAX_CACHED_SESSION_ITEMS = 96;
const MAX_PERSISTED_CACHED_SESSION_MESSAGES = 12;
const MAX_PERSISTED_CACHED_SESSION_TURNS = 8;
const MAX_PERSISTED_CACHED_SESSION_ITEMS = 32;
const TRANSIENT_SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const PERSISTED_SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_STALE_GRACE_MS = 2 * 60 * 1000;

interface AgentSessionCachedSnapshotTrimLimits {
  maxMessages: number;
  maxTurns: number;
  maxItems: number;
}

interface AgentSessionCachedSnapshotPolicy {
  limits: AgentSessionCachedSnapshotTrimLimits;
  maxEntries: number;
  ttlMs: number;
  staleGraceMs: number;
}

interface LoadAgentSessionCachedSnapshotOptions {
  nowMs?: number;
  topicUpdatedAt?: number | Date | string | null;
  messagesCount?: number | null;
}

interface SaveAgentSessionCachedSnapshotOptions {
  nowMs?: number;
  sessionUpdatedAt?: number | Date | string | null;
  messagesCount?: number | null;
  historyTruncated?: boolean | null;
}

const TRANSIENT_SNAPSHOT_LIMITS: AgentSessionCachedSnapshotTrimLimits = {
  maxMessages: MAX_CACHED_SESSION_MESSAGES,
  maxTurns: MAX_CACHED_SESSION_TURNS,
  maxItems: MAX_CACHED_SESSION_ITEMS,
};

const PERSISTED_SNAPSHOT_LIMITS: AgentSessionCachedSnapshotTrimLimits = {
  maxMessages: MAX_PERSISTED_CACHED_SESSION_MESSAGES,
  maxTurns: MAX_PERSISTED_CACHED_SESSION_TURNS,
  maxItems: MAX_PERSISTED_CACHED_SESSION_ITEMS,
};

const TRANSIENT_SNAPSHOT_POLICY: AgentSessionCachedSnapshotPolicy = {
  limits: TRANSIENT_SNAPSHOT_LIMITS,
  maxEntries: MAX_CACHED_SESSION_SNAPSHOTS,
  ttlMs: TRANSIENT_SNAPSHOT_TTL_MS,
  staleGraceMs: SNAPSHOT_STALE_GRACE_MS,
};

const PERSISTED_SNAPSHOT_POLICY: AgentSessionCachedSnapshotPolicy = {
  limits: PERSISTED_SNAPSHOT_LIMITS,
  maxEntries: MAX_PERSISTED_CACHED_SESSION_SNAPSHOTS,
  ttlMs: PERSISTED_SNAPSHOT_TTL_MS,
  staleGraceMs: SNAPSHOT_STALE_GRACE_MS,
};

function trimCachedSnapshot(
  snapshot: AgentSessionCachedSnapshot,
  limits: AgentSessionCachedSnapshotTrimLimits = TRANSIENT_SNAPSHOT_LIMITS,
): AgentSessionCachedSnapshot {
  const messages = normalizeHistoryMessages(
    snapshot.messages.slice(-limits.maxMessages),
  );
  const threadTurns = snapshot.threadTurns.slice(-limits.maxTurns);
  const retainedTurnIds = new Set(
    threadTurns
      .map((turn) => (typeof turn.id === "string" ? turn.id.trim() : ""))
      .filter(Boolean),
  );
  const scopedThreadItems: AgentThreadItem[] = [];
  for (
    let index = snapshot.threadItems.length - 1;
    index >= 0 && scopedThreadItems.length < limits.maxItems;
    index -= 1
  ) {
    const item = snapshot.threadItems[index];
    if (!item) {
      continue;
    }

    const turnId = typeof item.turn_id === "string" ? item.turn_id.trim() : "";
    if (!turnId || retainedTurnIds.has(turnId)) {
      scopedThreadItems.push(item);
    }
  }
  scopedThreadItems.reverse();
  const threadItems = filterConversationThreadItems(
    normalizeLegacyThreadItems(scopedThreadItems),
  );
  const currentTurnId =
    typeof snapshot.currentTurnId === "string" &&
    retainedTurnIds.has(snapshot.currentTurnId)
      ? snapshot.currentTurnId
      : null;

  return {
    messages,
    threadTurns,
    threadItems,
    currentTurnId,
  };
}

function normalizeCachedMessages(value: unknown, limit: number): Message[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .slice(-limit)
    .map((message) => {
      if (!message || typeof message !== "object") {
        return null;
      }

      const record = message as Record<string, unknown>;
      const timestamp = record.timestamp;
      const normalizedTimestamp =
        typeof timestamp === "string" || typeof timestamp === "number"
          ? new Date(timestamp)
          : timestamp instanceof Date
            ? timestamp
            : null;

      if (!normalizedTimestamp) {
        return null;
      }

      return {
        ...record,
        timestamp: normalizedTimestamp,
      } as Message;
    })
    .filter((message): message is Message => message !== null);

  return normalizeHistoryMessages(normalized);
}

function normalizeCachedThreadTurns(
  value: unknown,
  limit: number,
): AgentThreadTurn[] {
  return Array.isArray(value)
    ? (value.slice(-limit).filter(Boolean) as AgentThreadTurn[])
    : [];
}

function normalizeCachedThreadItems(value: unknown): AgentThreadItem[] {
  return Array.isArray(value) ? (value as AgentThreadItem[]) : [];
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOptionalTimeMs(
  value: number | Date | string | null | undefined,
): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return null;
}

function normalizeOptionalCount(value: unknown): number | null {
  const count = readFiniteNumber(value);
  return count !== null && count >= 0 ? Math.trunc(count) : null;
}

function normalizeCachedSnapshotRecord(
  value: unknown,
  policy: AgentSessionCachedSnapshotPolicy,
  nowMs: number,
  options?: LoadAgentSessionCachedSnapshotOptions,
): AgentSessionCachedSnapshotRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const updatedAt = readFiniteNumber(record.updatedAt) ?? nowMs;
  const lastAccessedAt = readFiniteNumber(record.lastAccessedAt) ?? updatedAt;
  const expiresAt =
    readFiniteNumber(record.expiresAt) ?? updatedAt + policy.ttlMs;
  const staleUntil =
    readFiniteNumber(record.staleUntil) ?? expiresAt + policy.staleGraceMs;
  const sessionUpdatedAt =
    readFiniteNumber(record.sessionUpdatedAt) ??
    normalizeOptionalTimeMs(record.sessionUpdatedAt as string | null);
  const messagesCount = normalizeOptionalCount(record.messagesCount);
  const snapshot = trimCachedSnapshot(
    {
      messages: normalizeCachedMessages(
        record.messages,
        policy.limits.maxMessages,
      ),
      threadTurns: normalizeCachedThreadTurns(
        record.threadTurns,
        policy.limits.maxTurns,
      ),
      threadItems: normalizeCachedThreadItems(record.threadItems),
      currentTurnId:
        typeof record.currentTurnId === "string" ? record.currentTurnId : null,
    },
    policy.limits,
  );
  const topicUpdatedAt = normalizeOptionalTimeMs(options?.topicUpdatedAt);
  const topicMessagesCount = normalizeOptionalCount(options?.messagesCount);
  const isBehindTopic =
    (topicUpdatedAt !== null &&
      (sessionUpdatedAt === null || topicUpdatedAt > sessionUpdatedAt)) ||
    (topicMessagesCount !== null &&
      messagesCount !== null &&
      topicMessagesCount > messagesCount);
  const staleExpiresAt = isBehindTopic ? Math.min(expiresAt, nowMs) : expiresAt;
  const staleGraceUntil = isBehindTopic
    ? Math.max(staleUntil, nowMs + policy.staleGraceMs)
    : staleUntil;

  if (nowMs > staleGraceUntil) {
    return null;
  }

  return {
    ...snapshot,
    updatedAt,
    lastAccessedAt,
    expiresAt: staleExpiresAt,
    staleUntil: staleGraceUntil,
    sessionUpdatedAt,
    messagesCount,
    historyTruncated: record.historyTruncated === true,
  };
}

function toCachedSnapshot(
  record: AgentSessionCachedSnapshotRecord,
  storageKind: AgentSessionCachedSnapshotMetadata["storageKind"],
  nowMs: number,
): AgentSessionCachedSnapshot {
  return {
    messages: record.messages,
    threadTurns: record.threadTurns,
    threadItems: record.threadItems,
    currentTurnId: record.currentTurnId,
    cacheMetadata: {
      storageKind,
      freshness: nowMs < record.expiresAt ? "fresh" : "stale",
      updatedAt: record.updatedAt,
      lastAccessedAt: record.lastAccessedAt,
      expiresAt: record.expiresAt,
      staleUntil: record.staleUntil,
      sessionUpdatedAt: record.sessionUpdatedAt,
      messagesCount: record.messagesCount,
      historyTruncated: record.historyTruncated,
    },
  };
}

function pruneSnapshotEntries(
  snapshotMap: Record<string, unknown>,
  policy: AgentSessionCachedSnapshotPolicy,
  nowMs: number,
  options?: LoadAgentSessionCachedSnapshotOptions,
) {
  return Object.entries(snapshotMap)
    .map(
      ([id, value]) =>
        [
          id,
          normalizeCachedSnapshotRecord(value, policy, nowMs, options),
        ] as const,
    )
    .filter(
      (entry): entry is [string, AgentSessionCachedSnapshotRecord] =>
        entry[1] !== null,
    )
    .sort((left, right) => right[1].lastAccessedAt - left[1].lastAccessedAt)
    .slice(0, policy.maxEntries);
}

function hasSnapshotRecord(
  snapshotMap: Record<string, unknown>,
  sessionId: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(snapshotMap, sessionId);
}

function removeCachedSnapshotRecord(
  cacheKey: string,
  snapshotMap: Record<string, unknown>,
  sessionId: string,
  storageKind: AgentSessionCachedSnapshotMetadata["storageKind"],
) {
  if (!hasSnapshotRecord(snapshotMap, sessionId)) {
    return;
  }

  const nextMap = { ...snapshotMap };
  delete nextMap[sessionId];

  if (storageKind === "transient") {
    saveTransient(cacheKey, nextMap);
    return;
  }

  savePersisted(cacheKey, nextMap);
}

export function loadAgentSessionCachedSnapshot(
  workspaceId: string,
  sessionId: string,
  options: LoadAgentSessionCachedSnapshotOptions = {},
): AgentSessionCachedSnapshot | null {
  const nowMs = options.nowMs ?? Date.now();
  const cacheKey = getScopedStorageKey(workspaceId, "aster_session_snapshots");
  const snapshotMap = loadTransient<Record<string, unknown>>(cacheKey, {});
  const transientSnapshot = normalizeCachedSnapshotRecord(
    snapshotMap[sessionId],
    TRANSIENT_SNAPSHOT_POLICY,
    nowMs,
    options,
  );

  if (transientSnapshot) {
    return toCachedSnapshot(transientSnapshot, "transient", nowMs);
  }

  removeCachedSnapshotRecord(
    cacheKey,
    snapshotMap,
    sessionId,
    "transient",
  );

  const persistedCacheKey = getScopedStorageKey(
    workspaceId,
    "aster_session_snapshots_persisted",
  );
  const persistedSnapshotMap = loadPersisted<Record<string, unknown>>(
    persistedCacheKey,
    {},
  );
  const persistedSnapshot = normalizeCachedSnapshotRecord(
    persistedSnapshotMap[sessionId],
    PERSISTED_SNAPSHOT_POLICY,
    nowMs,
    options,
  );

  if (persistedSnapshot) {
    return toCachedSnapshot(persistedSnapshot, "persisted", nowMs);
  }

  removeCachedSnapshotRecord(
    persistedCacheKey,
    persistedSnapshotMap,
    sessionId,
    "persisted",
  );

  return null;
}

export function saveAgentSessionCachedSnapshot(
  workspaceId: string,
  sessionId: string,
  snapshot: AgentSessionCachedSnapshot,
  options: SaveAgentSessionCachedSnapshotOptions = {},
): void {
  const nowMs = options.nowMs ?? Date.now();
  const cacheKey = getScopedStorageKey(workspaceId, "aster_session_snapshots");
  const persistedCacheKey = getScopedStorageKey(
    workspaceId,
    "aster_session_snapshots_persisted",
  );
  const currentMap = loadTransient<Record<string, unknown>>(cacheKey, {});
  const persistedMap = loadPersisted<Record<string, unknown>>(
    persistedCacheKey,
    {},
  );
  const trimmedSnapshot = trimCachedSnapshot(
    snapshot,
    TRANSIENT_SNAPSHOT_LIMITS,
  );
  const persistedSnapshot = trimCachedSnapshot(
    snapshot,
    PERSISTED_SNAPSHOT_LIMITS,
  );
  const sessionUpdatedAt =
    normalizeOptionalTimeMs(options.sessionUpdatedAt) ??
    snapshot.cacheMetadata?.sessionUpdatedAt ??
    nowMs;
  const messagesCount =
    normalizeOptionalCount(options.messagesCount) ??
    snapshot.cacheMetadata?.messagesCount ??
    snapshot.messages.length;
  const historyTruncated =
    options.historyTruncated ??
    snapshot.cacheMetadata?.historyTruncated ??
    messagesCount > snapshot.messages.length;
  const nextTransientMap = {
    ...currentMap,
    [sessionId]: {
      ...trimmedSnapshot,
      updatedAt: nowMs,
      lastAccessedAt: nowMs,
      expiresAt: nowMs + TRANSIENT_SNAPSHOT_POLICY.ttlMs,
      staleUntil:
        nowMs +
        TRANSIENT_SNAPSHOT_POLICY.ttlMs +
        TRANSIENT_SNAPSHOT_POLICY.staleGraceMs,
      sessionUpdatedAt,
      messagesCount,
      historyTruncated,
    } satisfies AgentSessionCachedSnapshotRecord,
  };
  const nextPersistedMap = {
    ...persistedMap,
    [sessionId]: {
      ...persistedSnapshot,
      updatedAt: nowMs,
      lastAccessedAt: nowMs,
      expiresAt: nowMs + PERSISTED_SNAPSHOT_POLICY.ttlMs,
      staleUntil:
        nowMs +
        PERSISTED_SNAPSHOT_POLICY.ttlMs +
        PERSISTED_SNAPSHOT_POLICY.staleGraceMs,
      sessionUpdatedAt,
      messagesCount,
      historyTruncated,
    } satisfies AgentSessionCachedSnapshotRecord,
  };

  const prunedTransientEntries = pruneSnapshotEntries(
    nextTransientMap,
    TRANSIENT_SNAPSHOT_POLICY,
    nowMs,
  );
  const prunedPersistedEntries = pruneSnapshotEntries(
    nextPersistedMap,
    PERSISTED_SNAPSHOT_POLICY,
    nowMs,
  );

  saveTransient(cacheKey, Object.fromEntries(prunedTransientEntries));
  savePersisted(persistedCacheKey, Object.fromEntries(prunedPersistedEntries));
}

export function getAgentSessionScopedKeys(
  workspaceId: string,
): AgentSessionScopedKeys {
  return {
    currentSessionKey: getScopedStorageKey(workspaceId, "aster_curr_sessionId"),
    messagesKey: getScopedStorageKey(workspaceId, "aster_messages"),
    persistedSessionKey: getScopedStorageKey(
      workspaceId,
      "aster_last_sessionId",
    ),
    sessionSnapshotsKey: getScopedStorageKey(
      workspaceId,
      "aster_session_snapshots",
    ),
    turnsKey: getScopedStorageKey(workspaceId, "aster_thread_turns"),
    itemsKey: getScopedStorageKey(workspaceId, "aster_thread_items"),
    currentTurnKey: getScopedStorageKey(workspaceId, "aster_curr_turnId"),
  };
}
