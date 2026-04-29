import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultAgentRuntimeEventSource,
  dedupeAgentRuntimeEventNames,
  type AgentRuntimeEventSource,
} from "@/lib/api/agentRuntimeEvents";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import {
  buildTeamWorkspaceSessionFingerprint,
  type TeamWorkspaceActivityEntry,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeSessionSnapshot,
  type TeamWorkspaceRuntimeStatus,
} from "../teamWorkspaceRuntime";
import { type SessionLiveStreamState } from "../team-workspace-runtime/liveRuntimeProjector";
import {
  subscribeTeamWorkspaceStatusEvents,
  subscribeTeamWorkspaceStreamEvents,
} from "../team-workspace-runtime/runtimeEventSubscriptions";
import {
  collectInactiveSessionIds,
  pruneInactiveSessionRecord,
  reconcileActiveLiveRuntimeBySessionId,
} from "../team-workspace-runtime/runtimeStateReconciler";

const EVENT_ACTIVITY_REFRESH_DEBOUNCE_MS = 240;

interface UseTeamWorkspaceRuntimeOptions {
  currentSessionId?: string | null;
  currentSessionRuntimeStatus?: TeamWorkspaceRuntimeStatus;
  currentSessionLatestTurnStatus?: TeamWorkspaceRuntimeStatus;
  currentSessionQueuedTurnCount?: number;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
}

interface UseTeamWorkspaceRuntimeResult {
  liveRuntimeBySessionId: Record<string, TeamWorkspaceLiveRuntimeState>;
  liveActivityBySessionId: Record<string, TeamWorkspaceActivityEntry[]>;
  activityRefreshVersionBySessionId: Record<string, number>;
}

interface UseTeamWorkspaceRuntimeDeps {
  eventSource?: Pick<
    AgentRuntimeEventSource,
    "listenSubagentStatus" | "listenSubagentStream"
  >;
}

function buildActiveSubagentSnapshots(params: UseTeamWorkspaceRuntimeOptions) {
  const {
    currentSessionId,
    currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus,
    currentSessionQueuedTurnCount = 0,
    childSubagentSessions = [],
    subagentParentContext = null,
  } = params;
  const snapshots: TeamWorkspaceRuntimeSessionSnapshot[] = [];
  const seen = new Set<string>();

  if (subagentParentContext && currentSessionId) {
    snapshots.push({
      id: currentSessionId,
      runtimeStatus: currentSessionRuntimeStatus,
      latestTurnStatus: currentSessionLatestTurnStatus,
      queuedTurnCount: currentSessionQueuedTurnCount,
      teamPhase: undefined,
      teamParallelBudget: undefined,
      teamActiveCount: undefined,
      teamQueuedCount: undefined,
      providerConcurrencyGroup: undefined,
      providerParallelBudget: undefined,
      queueReason: undefined,
      retryableOverload: undefined,
    });
    seen.add(currentSessionId);
  }

  const siblingSessions = subagentParentContext
    ? (subagentParentContext.sibling_subagent_sessions ?? [])
    : childSubagentSessions;

  siblingSessions.forEach((session) => {
    if (seen.has(session.id)) {
      return;
    }
    seen.add(session.id);
    snapshots.push({
      id: session.id,
      runtimeStatus: session.runtime_status,
      latestTurnStatus: session.latest_turn_status,
      queuedTurnCount: session.queued_turn_count,
      teamPhase: session.team_phase,
      teamParallelBudget: session.team_parallel_budget,
      teamActiveCount: session.team_active_count,
      teamQueuedCount: session.team_queued_count,
      providerConcurrencyGroup: session.provider_concurrency_group,
      providerParallelBudget: session.provider_parallel_budget,
      queueReason: session.queue_reason,
      retryableOverload: session.retryable_overload,
      updatedAt: session.updated_at,
    });
  });

  return snapshots;
}

export function useTeamWorkspaceRuntime(
  options: UseTeamWorkspaceRuntimeOptions,
  deps: UseTeamWorkspaceRuntimeDeps = {},
): UseTeamWorkspaceRuntimeResult {
  const {
    currentSessionId,
    currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus,
    currentSessionQueuedTurnCount = 0,
    childSubagentSessions = [],
    subagentParentContext = null,
  } = options;
  const { eventSource = defaultAgentRuntimeEventSource } = deps;
  const [liveRuntimeBySessionId, setLiveRuntimeBySessionId] = useState<
    Record<string, TeamWorkspaceLiveRuntimeState>
  >({});
  const liveRuntimeBySessionIdRef = useRef<
    Record<string, TeamWorkspaceLiveRuntimeState>
  >({});
  const [liveActivityBySessionId, setLiveActivityBySessionId] = useState<
    Record<string, TeamWorkspaceActivityEntry[]>
  >({});
  const [
    activityRefreshVersionBySessionId,
    setActivityRefreshVersionBySessionId,
  ] = useState<Record<string, number>>({});
  const refreshTimersRef = useRef<Record<string, number>>({});
  const activeSnapshotByIdRef = useRef<
    Map<string, TeamWorkspaceRuntimeSessionSnapshot>
  >(new Map());
  const baseFingerprintByIdRef = useRef<Map<string, string>>(new Map());
  const liveStreamStateBySessionIdRef = useRef<
    Record<string, SessionLiveStreamState>
  >({});
  const toolNameBySessionIdRef = useRef<Record<string, Record<string, string>>>(
    {},
  );

  const activeSnapshots = useMemo(
    () =>
      buildActiveSubagentSnapshots({
        currentSessionId,
        currentSessionRuntimeStatus,
        currentSessionLatestTurnStatus,
        currentSessionQueuedTurnCount,
        childSubagentSessions,
        subagentParentContext,
      }),
    [
      childSubagentSessions,
      currentSessionId,
      currentSessionLatestTurnStatus,
      currentSessionQueuedTurnCount,
      currentSessionRuntimeStatus,
      subagentParentContext,
    ],
  );
  const activeSessionKey = useMemo(
    () =>
      activeSnapshots
        .map((session) => buildTeamWorkspaceSessionFingerprint(session))
        .join("|"),
    [activeSnapshots],
  );
  const activeSnapshotById = useMemo(
    () => new Map(activeSnapshots.map((session) => [session.id, session])),
    [activeSnapshots],
  );
  const baseFingerprintById = useMemo(
    () =>
      new Map(
        activeSnapshots.map((session) => [
          session.id,
          buildTeamWorkspaceSessionFingerprint(session),
        ]),
      ),
    [activeSnapshots],
  );

  useEffect(() => {
    activeSnapshotByIdRef.current = activeSnapshotById;
    baseFingerprintByIdRef.current = baseFingerprintById;
  }, [activeSnapshotById, baseFingerprintById]);

  useEffect(() => {
    liveRuntimeBySessionIdRef.current = liveRuntimeBySessionId;
  }, [liveRuntimeBySessionId]);

  const scheduleActivityRefresh = useCallback((sessionId: string) => {
    if (refreshTimersRef.current[sessionId] !== undefined) {
      return;
    }

    refreshTimersRef.current[sessionId] = window.setTimeout(() => {
      delete refreshTimersRef.current[sessionId];
      if (!activeSnapshotByIdRef.current.has(sessionId)) {
        return;
      }

      setActivityRefreshVersionBySessionId((previous) => ({
        ...previous,
        [sessionId]: (previous[sessionId] ?? 0) + 1,
      }));
    }, EVENT_ACTIVITY_REFRESH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(refreshTimersRef.current)) {
        window.clearTimeout(timerId);
      }
      refreshTimersRef.current = {};
    };
  }, []);

  const setStreamState = useCallback(
    (sessionId: string, nextState: SessionLiveStreamState | undefined) => {
      if (nextState) {
        liveStreamStateBySessionIdRef.current[sessionId] = nextState;
        return;
      }

      delete liveStreamStateBySessionIdRef.current[sessionId];
    },
    [],
  );

  const setToolNames = useCallback(
    (sessionId: string, nextToolNames: Record<string, string> | undefined) => {
      if (nextToolNames) {
        toolNameBySessionIdRef.current[sessionId] = nextToolNames;
        return;
      }

      delete toolNameBySessionIdRef.current[sessionId];
    },
    [],
  );

  useEffect(() => {
    const activeSessionIds = new Set(
      activeSnapshots.map((session) => session.id),
    );

    for (const sessionId of collectInactiveSessionIds(
      refreshTimersRef.current,
      activeSessionIds,
    )) {
      const timerId = refreshTimersRef.current[sessionId];
      if (timerId === undefined) {
        continue;
      }
      window.clearTimeout(timerId);
      delete refreshTimersRef.current[sessionId];
    }

    setLiveActivityBySessionId((previous) => {
      return pruneInactiveSessionRecord(previous, activeSessionIds);
    });

    setActivityRefreshVersionBySessionId((previous) => {
      return pruneInactiveSessionRecord(previous, activeSessionIds);
    });

    setLiveRuntimeBySessionId((previous) => {
      return reconcileActiveLiveRuntimeBySessionId(
        previous,
        activeSessionIds,
        baseFingerprintById,
      );
    });

    for (const sessionId of collectInactiveSessionIds(
      liveStreamStateBySessionIdRef.current,
      activeSessionIds,
    )) {
      delete liveStreamStateBySessionIdRef.current[sessionId];
    }
    for (const sessionId of collectInactiveSessionIds(
      toolNameBySessionIdRef.current,
      activeSessionIds,
    )) {
      delete toolNameBySessionIdRef.current[sessionId];
    }
  }, [activeSessionKey, activeSnapshots, baseFingerprintById]);

  useEffect(() => {
    const eventNames = [
      currentSessionId ? currentSessionId : null,
      subagentParentContext?.parent_session_id
        ? subagentParentContext.parent_session_id
        : null,
    ];
    const statusSessionIds = dedupeAgentRuntimeEventNames(eventNames);

    if (statusSessionIds.length === 0) {
      return;
    }

    let disposed = false;
    let unsubscribe = () => {};

    void subscribeTeamWorkspaceStatusEvents({
      sessionIds: statusSessionIds,
      eventSource,
      getSnapshot: (sessionId) => activeSnapshotByIdRef.current.get(sessionId),
      getBaseFingerprint: (sessionId, session) =>
        baseFingerprintByIdRef.current.get(sessionId) ??
        buildTeamWorkspaceSessionFingerprint(session),
      getCurrentRuntime: (sessionId) =>
        liveRuntimeBySessionIdRef.current[sessionId],
      setLiveRuntimeBySessionId,
      setLiveActivityBySessionId,
      scheduleActivityRefresh,
    }).then((nextUnsubscribe) => {
      if (disposed) {
        nextUnsubscribe();
        return;
      }

      unsubscribe = nextUnsubscribe;
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [
    activeSessionKey,
    currentSessionId,
    eventSource,
    subagentParentContext?.parent_session_id,
    scheduleActivityRefresh,
  ]);

  useEffect(() => {
    const sessionIds = activeSnapshots.map((session) => session.id);
    if (sessionIds.length === 0) {
      return;
    }

    let disposed = false;
    let unsubscribe = () => {};

    void subscribeTeamWorkspaceStreamEvents({
      sessionIds,
      eventSource,
      getSnapshot: (sessionId) => activeSnapshotByIdRef.current.get(sessionId),
      getBaseFingerprint: (sessionId, session) =>
        baseFingerprintByIdRef.current.get(sessionId) ??
        buildTeamWorkspaceSessionFingerprint(session),
      getCurrentRuntime: (sessionId) =>
        liveRuntimeBySessionIdRef.current[sessionId],
      getStreamState: (sessionId) =>
        liveStreamStateBySessionIdRef.current[sessionId],
      setStreamState,
      getToolNames: (sessionId) => toolNameBySessionIdRef.current[sessionId],
      setToolNames,
      setLiveRuntimeBySessionId,
      setLiveActivityBySessionId,
      scheduleActivityRefresh,
    }).then((nextUnsubscribe) => {
      if (disposed) {
        nextUnsubscribe();
        return;
      }

      unsubscribe = nextUnsubscribe;
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [
    activeSessionKey,
    activeSnapshots,
    eventSource,
    scheduleActivityRefresh,
    setStreamState,
    setToolNames,
  ]);

  return {
    liveRuntimeBySessionId,
    liveActivityBySessionId,
    activityRefreshVersionBySessionId,
  };
}
