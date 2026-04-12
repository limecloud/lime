import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAgentRuntimeSession } from "@/lib/api/agentRuntime";
import {
  buildPreviewableRailSessionsSyncKey,
  collectStaleSessionActivityTargets,
  extractSessionActivitySnapshot,
  type ActivityPreviewSession,
  type SelectedSessionActivityState,
  type SessionActivityPreviewState,
} from "../../team-workspace-runtime/activityPreviewSelectors";

const DEFAULT_ACTIVITY_PREVIEW_POLL_INTERVAL_MS = 1500;

interface UseTeamWorkspaceActivityPreviewSyncParams {
  activityRefreshVersionBySessionId?: Record<string, number>;
  activityTimelineEntryLimit: number;
  basePreviewableRailSessions: ActivityPreviewSession[];
  pollIntervalMs?: number;
  selectedSessionActivityState: SelectedSessionActivityState;
}

export function useTeamWorkspaceActivityPreviewSync({
  activityRefreshVersionBySessionId = {},
  activityTimelineEntryLimit,
  basePreviewableRailSessions,
  pollIntervalMs = DEFAULT_ACTIVITY_PREVIEW_POLL_INTERVAL_MS,
  selectedSessionActivityState,
}: UseTeamWorkspaceActivityPreviewSyncParams) {
  const [sessionActivityPreviewById, setSessionActivityPreviewById] = useState<
    Record<string, SessionActivityPreviewState>
  >({});
  const sessionActivityPreviewByIdRef = useRef<
    Record<string, SessionActivityPreviewState>
  >({});
  const pendingSessionActivityRequestsRef = useRef(new Set<string>());

  useEffect(() => {
    sessionActivityPreviewByIdRef.current = sessionActivityPreviewById;
  }, [sessionActivityPreviewById]);

  const previewableRailSessionsSyncKey = useMemo(
    () =>
      buildPreviewableRailSessionsSyncKey({
        sessions: basePreviewableRailSessions,
        activityRefreshVersionBySessionId,
      }),
    [activityRefreshVersionBySessionId, basePreviewableRailSessions],
  );

  const syncSessionActivityPreview = useCallback(
    async (
      sessionId: string,
      fingerprint: string,
      refreshVersion = 0,
      options?: { force?: boolean },
    ) => {
      const current = sessionActivityPreviewByIdRef.current[sessionId];
      const shouldForceRefresh =
        options?.force || (current?.refreshVersion ?? 0) < refreshVersion;
      if (
        !shouldForceRefresh &&
        current?.status === "ready" &&
        current.fingerprint === fingerprint &&
        (current.refreshVersion ?? 0) === refreshVersion
      ) {
        return;
      }

      if (pendingSessionActivityRequestsRef.current.has(sessionId)) {
        return;
      }

      pendingSessionActivityRequestsRef.current.add(sessionId);
      setSessionActivityPreviewById((previous) => {
        const currentState = previous[sessionId];
        if (
          currentState?.status === "loading" &&
          currentState.fingerprint === fingerprint
        ) {
          return previous;
        }

        return {
          ...previous,
          [sessionId]: {
            preview: currentState?.preview ?? null,
            entries: currentState?.entries ?? [],
            status: "loading",
            errorMessage: undefined,
            fingerprint,
            refreshVersion,
            syncedAt: currentState?.syncedAt,
          },
        };
      });

      try {
        const detail = await getAgentRuntimeSession(sessionId);
        const activitySnapshot = extractSessionActivitySnapshot(
          detail,
          activityTimelineEntryLimit,
        );
        const syncedAt = Date.now();
        setSessionActivityPreviewById((previous) => ({
          ...previous,
          [sessionId]: {
            preview: activitySnapshot.preview,
            entries: activitySnapshot.entries,
            status: "ready",
            errorMessage: undefined,
            fingerprint,
            refreshVersion,
            syncedAt,
          },
        }));
      } catch (error) {
        setSessionActivityPreviewById((previous) => ({
          ...previous,
          [sessionId]: {
            preview: previous[sessionId]?.preview ?? null,
            entries: previous[sessionId]?.entries ?? [],
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "同步最近过程失败",
            fingerprint,
            refreshVersion,
            syncedAt: previous[sessionId]?.syncedAt,
          },
        }));
      } finally {
        pendingSessionActivityRequestsRef.current.delete(sessionId);
      }
    },
    [activityTimelineEntryLimit],
  );

  useEffect(() => {
    if (
      !selectedSessionActivityState.activityId ||
      !selectedSessionActivityState.fingerprint
    ) {
      return;
    }

    const sessionId = selectedSessionActivityState.activityId;
    const fingerprint = selectedSessionActivityState.fingerprint;
    let pollTimer: number | null = null;
    const cachedPreview = sessionActivityPreviewByIdRef.current[sessionId];

    if (
      !selectedSessionActivityState.shouldPoll &&
      cachedPreview?.status === "ready" &&
      cachedPreview.fingerprint === fingerprint &&
      (cachedPreview.refreshVersion ?? 0) ===
        selectedSessionActivityState.refreshVersion
    ) {
      return;
    }

    const syncSelectedSessionActivity = async () => {
      const current = sessionActivityPreviewByIdRef.current[sessionId];
      await syncSessionActivityPreview(
        sessionId,
        fingerprint,
        selectedSessionActivityState.refreshVersion,
        {
          force:
            selectedSessionActivityState.shouldPoll ||
            (current?.refreshVersion ?? 0) <
              selectedSessionActivityState.refreshVersion,
        },
      );
    };

    void syncSelectedSessionActivity();

    if (selectedSessionActivityState.shouldPoll) {
      pollTimer = window.setInterval(() => {
        void syncSelectedSessionActivity();
      }, pollIntervalMs);
    }

    return () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [
    pollIntervalMs,
    selectedSessionActivityState.activityId,
    selectedSessionActivityState.fingerprint,
    selectedSessionActivityState.refreshVersion,
    selectedSessionActivityState.shouldPoll,
    syncSessionActivityPreview,
  ]);

  useEffect(() => {
    const staleTargets = collectStaleSessionActivityTargets({
      sessions: basePreviewableRailSessions,
      previewBySessionId: sessionActivityPreviewByIdRef.current,
      activityRefreshVersionBySessionId,
    });

    if (staleTargets.length === 0) {
      return;
    }

    let cancelled = false;

    const prefetchPreviews = async () => {
      await Promise.allSettled(
        staleTargets.map((target) => {
          if (cancelled) {
            return Promise.resolve();
          }

          return syncSessionActivityPreview(
            target.sessionId,
            target.fingerprint,
            target.refreshVersion,
            {
              force: true,
            },
          );
        }),
      );
    };

    void prefetchPreviews();

    return () => {
      cancelled = true;
    };
  }, [
    activityRefreshVersionBySessionId,
    basePreviewableRailSessions,
    previewableRailSessionsSyncKey,
    syncSessionActivityPreview,
  ]);

  return {
    sessionActivityPreviewById,
  };
}
