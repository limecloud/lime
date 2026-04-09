import { normalizeLegacyThreadItems } from "@/lib/api/agentTextNormalization";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import { filterConversationThreadItems } from "../utils/threadTimelineView";
import { normalizeHistoryMessages } from "./agentChatHistory";
import { loadTransient, saveTransient } from "./agentChatStorage";
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
): AgentSessionCachedSnapshotRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    messages: normalizeCachedMessages(record.messages),
    threadTurns: normalizeCachedThreadTurns(record.threadTurns),
    threadItems: normalizeCachedThreadItems(record.threadItems),
    currentTurnId:
      typeof record.currentTurnId === "string" ? record.currentTurnId : null,
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
  const snapshot = normalizeCachedSnapshotRecord(snapshotMap[sessionId]);

  if (!snapshot) {
    return null;
  }

  return {
    messages: snapshot.messages,
    threadTurns: snapshot.threadTurns,
    threadItems: snapshot.threadItems,
    currentTurnId: snapshot.currentTurnId,
  };
}

export function saveAgentSessionCachedSnapshot(
  workspaceId: string,
  sessionId: string,
  snapshot: AgentSessionCachedSnapshot,
): void {
  const cacheKey = getScopedStorageKey(workspaceId, "aster_session_snapshots");
  const currentMap = loadTransient<Record<string, unknown>>(cacheKey, {});
  const nextMap = {
    ...currentMap,
    [sessionId]: {
      ...snapshot,
      updatedAt: Date.now(),
    } satisfies AgentSessionCachedSnapshotRecord,
  };

  const prunedEntries = Object.entries(nextMap)
    .map(([id, value]) => [id, normalizeCachedSnapshotRecord(value)] as const)
    .filter(
      (
        entry,
      ): entry is [string, AgentSessionCachedSnapshotRecord] =>
        entry[1] !== null,
    )
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, MAX_CACHED_SESSION_SNAPSHOTS);

  saveTransient(cacheKey, Object.fromEntries(prunedEntries));
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
