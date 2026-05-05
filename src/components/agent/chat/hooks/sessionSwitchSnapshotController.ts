import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import type { AgentSessionCachedSnapshot } from "./agentSessionScopedStorage";

export interface SessionSwitchLocalSnapshotOverride {
  sessionId: string;
  messages: Message[];
  threadTurns: AgentThreadTurn[];
  threadItems: AgentThreadItem[];
}

export function shouldLoadCachedTopicSnapshot(params: {
  currentSessionId?: string | null;
  topicId: string;
}): boolean {
  return params.currentSessionId !== params.topicId;
}

export function shouldApplyCachedTopicSnapshot(params: {
  currentSessionId?: string | null;
  topicId: string;
}): boolean {
  return shouldLoadCachedTopicSnapshot(params);
}

export function shouldRefreshCachedSnapshotImmediately(params: {
  cacheFreshness?: "fresh" | "stale" | null;
  topicStatus?: string | null;
}): boolean {
  return (
    params.cacheFreshness === "stale" ||
    params.topicStatus === "running" ||
    params.topicStatus === "waiting"
  );
}

export function shouldApplyPendingSessionShell(params: {
  currentSessionId?: string | null;
  topicId: string;
  cachedSnapshot?: AgentSessionCachedSnapshot | null;
}): boolean {
  return params.currentSessionId !== params.topicId && !params.cachedSnapshot;
}

export function buildSessionSwitchStartMetricContext(params: {
  cachedSnapshot?: AgentSessionCachedSnapshot | null;
  currentSessionId?: string | null;
  messagesCount: number;
  refreshCachedSnapshotImmediately: boolean;
  topicId: string;
  workspaceId?: string | null;
}): Record<string, unknown> {
  const cachedSnapshotMetadata = params.cachedSnapshot?.cacheMetadata;
  return {
    cacheFreshness: cachedSnapshotMetadata?.freshness ?? null,
    cacheStorageKind: cachedSnapshotMetadata?.storageKind ?? null,
    cachedLocalMessagesCount: params.cachedSnapshot?.messages.length ?? 0,
    currentSessionId: params.currentSessionId ?? null,
    messagesCount: params.messagesCount,
    refreshCachedSnapshotImmediately:
      params.refreshCachedSnapshotImmediately,
    sessionId: params.topicId,
    topicId: params.topicId,
    workspaceId: params.workspaceId,
  };
}

export function buildSessionSwitchDeferHydrationMetricContext(params: {
  cachedSnapshot?: AgentSessionCachedSnapshot | null;
  currentSessionId?: string | null;
  refreshImmediately: boolean;
  topicId: string;
  workspaceId?: string | null;
}): Record<string, unknown> {
  const cachedSnapshotMetadata = params.cachedSnapshot?.cacheMetadata;
  return {
    cacheFreshness: cachedSnapshotMetadata?.freshness ?? null,
    cacheStorageKind: cachedSnapshotMetadata?.storageKind ?? null,
    cachedLocalMessagesCount: params.cachedSnapshot?.messages.length ?? 0,
    currentSessionId: params.currentSessionId ?? null,
    refreshImmediately: params.refreshImmediately,
    sessionId: params.topicId,
    topicId: params.topicId,
    workspaceId: params.workspaceId,
  };
}

export function buildPendingSessionShellMetricContext(params: {
  currentSessionId?: string | null;
  topicId: string;
  workspaceId?: string | null;
}): Record<string, unknown> {
  return {
    currentSessionId: params.currentSessionId ?? null,
    sessionId: params.topicId,
    topicId: params.topicId,
    workspaceId: params.workspaceId,
  };
}

export function buildSessionSwitchLocalSnapshotOverride(params: {
  cachedSnapshot?: AgentSessionCachedSnapshot | null;
  currentSessionId?: string | null;
  messages: Message[];
  threadTurns: AgentThreadTurn[];
  threadItems: AgentThreadItem[];
  topicId: string;
}): SessionSwitchLocalSnapshotOverride | null {
  const cachedSnapshot = params.cachedSnapshot;
  if (
    !cachedSnapshot ||
    params.currentSessionId !== params.topicId ||
    params.messages !== cachedSnapshot.messages ||
    params.threadTurns !== cachedSnapshot.threadTurns ||
    params.threadItems !== cachedSnapshot.threadItems
  ) {
    return null;
  }

  return {
    sessionId: params.topicId,
    messages: cachedSnapshot.messages,
    threadTurns: cachedSnapshot.threadTurns,
    threadItems: cachedSnapshot.threadItems,
  };
}
