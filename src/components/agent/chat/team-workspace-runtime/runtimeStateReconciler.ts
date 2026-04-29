import type {
  TeamWorkspaceActivityEntry,
  TeamWorkspaceLiveRuntimeState,
} from "../teamWorkspaceRuntime";

export type SessionScopedRecord<TValue> = Record<string, TValue>;

export function collectInactiveSessionIds(
  record: Record<string, unknown>,
  activeSessionIds: Set<string>,
): string[] {
  return Object.keys(record).filter(
    (sessionId) => !activeSessionIds.has(sessionId),
  );
}

export function pruneInactiveSessionRecord<TValue>(
  record: SessionScopedRecord<TValue>,
  activeSessionIds: Set<string>,
): SessionScopedRecord<TValue> {
  const nextEntries = Object.entries(record).filter(([sessionId]) =>
    activeSessionIds.has(sessionId),
  );

  if (nextEntries.length === Object.keys(record).length) {
    return record;
  }

  return Object.fromEntries(nextEntries);
}

export function reconcileActiveLiveRuntimeBySessionId(
  record: SessionScopedRecord<TeamWorkspaceLiveRuntimeState>,
  activeSessionIds: Set<string>,
  baseFingerprintById: Map<string, string>,
): SessionScopedRecord<TeamWorkspaceLiveRuntimeState> {
  const nextEntries = Object.entries(record).filter(([sessionId, live]) => {
    if (!activeSessionIds.has(sessionId)) {
      return false;
    }

    return baseFingerprintById.get(sessionId) === live.baseFingerprint;
  });

  if (nextEntries.length === Object.keys(record).length) {
    return record;
  }

  return Object.fromEntries(nextEntries);
}

export type TeamWorkspaceLiveActivityBySessionId = SessionScopedRecord<
  TeamWorkspaceActivityEntry[]
>;
export type TeamWorkspaceActivityRefreshVersionBySessionId =
  SessionScopedRecord<number>;
