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
}

interface AgentSessionCachedSnapshotRecord
  extends AgentSessionCachedSnapshot {
  updatedAt: number;
}

const MAX_CACHED_SESSION_SNAPSHOTS = 12;
const MAX_CACHED_SESSION_MESSAGES = 32;
const MAX_CACHED_SESSION_TURNS = 24;
const MAX_CACHED_SESSION_ITEMS = 96;
const MAX_PERSISTED_CACHED_SESSION_MESSAGES = 12;
const MAX_PERSISTED_CACHED_SESSION_TURNS = 8;
const MAX_PERSISTED_CACHED_SESSION_ITEMS = 32;

interface AgentSessionCachedSnapshotTrimLimits {
  maxMessages: number;
  maxTurns: number;
  maxItems: number;
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
  const threadItems = filterConversationThreadItems(
    normalizeLegacyThreadItems(
      snapshot.threadItems
        .filter((item) => {
          const turnId =
            typeof item.turn_id === "string" ? item.turn_id.trim() : "";
          return !turnId || retainedTurnIds.has(turnId);
        })
        .slice(-limits.maxItems),
    ),
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

function normalizeCachedMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
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

function normalizeCachedThreadTurns(value: unknown): AgentThreadTurn[] {
  return Array.isArray(value)
    ? (value.filter(Boolean) as AgentThreadTurn[])
    : [];
}

function normalizeCachedThreadItems(value: unknown): AgentThreadItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return filterConversationThreadItems(
    normalizeLegacyThreadItems(value as AgentThreadItem[]),
  );
}

function normalizeCachedSnapshotRecord(
  value: unknown,
  limits?: AgentSessionCachedSnapshotTrimLimits,
): AgentSessionCachedSnapshotRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const snapshot = trimCachedSnapshot(
    {
      messages: normalizeCachedMessages(record.messages),
      threadTurns: normalizeCachedThreadTurns(record.threadTurns),
      threadItems: normalizeCachedThreadItems(record.threadItems),
      currentTurnId:
        typeof record.currentTurnId === "string" ? record.currentTurnId : null,
    },
    limits,
  );

  return {
    ...snapshot,
    updatedAt:
      typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : 0,
  };
}

export function loadAgentSessionCachedSnapshot(
  workspaceId: string,
  sessionId: string,
): AgentSessionCachedSnapshot | null {
  const cacheKey = getScopedStorageKey(workspaceId, "aster_session_snapshots");
  const snapshotMap = loadTransient<Record<string, unknown>>(cacheKey, {});
  const transientSnapshot = normalizeCachedSnapshotRecord(
    snapshotMap[sessionId],
    TRANSIENT_SNAPSHOT_LIMITS,
  );

  if (transientSnapshot) {
    return {
      messages: transientSnapshot.messages,
      threadTurns: transientSnapshot.threadTurns,
      threadItems: transientSnapshot.threadItems,
      currentTurnId: transientSnapshot.currentTurnId,
    };
  }

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
    PERSISTED_SNAPSHOT_LIMITS,
  );

  if (!persistedSnapshot) {
    return null;
  }

  return {
    messages: persistedSnapshot.messages,
    threadTurns: persistedSnapshot.threadTurns,
    threadItems: persistedSnapshot.threadItems,
    currentTurnId: persistedSnapshot.currentTurnId,
  };
}

export function saveAgentSessionCachedSnapshot(
  workspaceId: string,
  sessionId: string,
  snapshot: AgentSessionCachedSnapshot,
): void {
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
  const trimmedSnapshot = trimCachedSnapshot(snapshot, TRANSIENT_SNAPSHOT_LIMITS);
  const persistedSnapshot = trimCachedSnapshot(
    snapshot,
    PERSISTED_SNAPSHOT_LIMITS,
  );
  const nextTransientMap = {
    ...currentMap,
    [sessionId]: {
      ...trimmedSnapshot,
      updatedAt: Date.now(),
    } satisfies AgentSessionCachedSnapshotRecord,
  };
  const nextPersistedMap = {
    ...persistedMap,
    [sessionId]: {
      ...persistedSnapshot,
      updatedAt: Date.now(),
    } satisfies AgentSessionCachedSnapshotRecord,
  };

  const pruneSnapshotEntries = (
    snapshotMap: Record<string, unknown>,
    limits: AgentSessionCachedSnapshotTrimLimits,
  ) =>
    Object.entries(snapshotMap)
      .map(
        ([id, value]) =>
          [id, normalizeCachedSnapshotRecord(value, limits)] as const,
      )
      .filter(
        (
          entry,
        ): entry is [string, AgentSessionCachedSnapshotRecord] =>
          entry[1] !== null,
      )
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_CACHED_SESSION_SNAPSHOTS);

  const prunedTransientEntries = pruneSnapshotEntries(
    nextTransientMap,
    TRANSIENT_SNAPSHOT_LIMITS,
  );
  const prunedPersistedEntries = pruneSnapshotEntries(
    nextPersistedMap,
    PERSISTED_SNAPSHOT_LIMITS,
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
