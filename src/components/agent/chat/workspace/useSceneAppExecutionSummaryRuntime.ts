import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getSceneAppScorecard,
  listSceneAppRuns,
  type SceneAppRunSummary,
  type SceneAppScorecard,
} from "@/lib/api/sceneapp";
import {
  backfillSceneAppExecutionSummaryViewModel,
  buildSceneAppExecutionSummaryRunDetailViewModel,
  type SceneAppExecutionSummaryViewModel,
  type SceneAppRunDetailViewModel,
} from "@/lib/sceneapp/product";
import { findLatestSceneAppPackResultRun } from "@/lib/sceneapp";

const SCENEAPP_RUNTIME_POLL_INTERVAL_MS = 4_000;

function findSceneAppRunForSession(
  runs: SceneAppRunSummary[],
  sessionId: string,
): SceneAppRunSummary | null {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }

  return (
    runs.find((run) => run.sessionId?.trim() === normalizedSessionId) ?? null
  );
}

function shouldContinuePolling(params: {
  sessionId: string;
  run: SceneAppRunSummary | null;
  isSending: boolean;
}): boolean {
  if (!params.sessionId.trim()) {
    return false;
  }

  if (params.isSending) {
    return true;
  }

  return (
    !params.run ||
    params.run.status === "queued" ||
    params.run.status === "running"
  );
}

async function loadSceneAppExecutionRuntimeSnapshot(sceneappId: string): Promise<{
  runs: SceneAppRunSummary[];
  scorecard: SceneAppScorecard | null;
}> {
  const [runsResult, scorecardResult] = await Promise.allSettled([
    listSceneAppRuns(sceneappId),
    getSceneAppScorecard(sceneappId),
  ]);

  return {
    runs: runsResult.status === "fulfilled" ? runsResult.value : [],
    scorecard:
      scorecardResult.status === "fulfilled" ? scorecardResult.value : null,
  };
}

interface UseSceneAppExecutionSummaryRuntimeParams {
  initialSummary?: SceneAppExecutionSummaryViewModel | null;
  sessionId?: string | null;
  isSending: boolean;
}

export interface SceneAppExecutionSummaryRuntimeState {
  summary?: SceneAppExecutionSummaryViewModel | null;
  latestPackResultDetailView: SceneAppRunDetailViewModel | null;
  latestPackResultUsesFallback: boolean;
  reviewTargetRunSummary: SceneAppRunSummary | null;
  loading: boolean;
  requestRefresh: () => void;
}

function createInitialRuntimeState(params: {
  initialSummary?: SceneAppExecutionSummaryViewModel | null;
  sessionId?: string | null;
}): Omit<SceneAppExecutionSummaryRuntimeState, "requestRefresh"> {
  return {
    summary: params.initialSummary,
    latestPackResultDetailView: null,
    latestPackResultUsesFallback: false,
    reviewTargetRunSummary: null,
    loading: Boolean(params.initialSummary && params.sessionId?.trim()),
  };
}

export function useSceneAppExecutionSummaryRuntime({
  initialSummary,
  sessionId,
  isSending,
}: UseSceneAppExecutionSummaryRuntimeParams):
  | SceneAppExecutionSummaryRuntimeState
  | undefined {
  const [state, setState] = useState<SceneAppExecutionSummaryRuntimeState>(() =>
    ({
      ...createInitialRuntimeState({
        initialSummary,
        sessionId,
      }),
      requestRefresh: () => undefined,
    }),
  );
  const [refreshNonce, setRefreshNonce] = useState(0);
  const requestRefresh = useCallback(() => {
    setRefreshNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    setState(
      {
        ...createInitialRuntimeState({
          initialSummary,
          sessionId,
        }),
        requestRefresh,
      },
    );
  }, [initialSummary, requestRefresh, sessionId]);

  useEffect(() => {
    const baseSummary = initialSummary;
    const normalizedSessionId = sessionId?.trim() || "";
    if (!baseSummary || !normalizedSessionId) {
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      setState((current) => ({
        ...current,
        summary: current.summary ?? baseSummary,
        loading: true,
      }));
      const snapshot = await loadSceneAppExecutionRuntimeSnapshot(
        baseSummary.sceneappId,
      );
      if (cancelled) {
        return;
      }

      const matchedRun = findSceneAppRunForSession(
        snapshot.runs,
        normalizedSessionId,
      );
      const latestPackResultRun = findLatestSceneAppPackResultRun({
        selectedRun: matchedRun,
        runs: snapshot.runs,
      });
      setState({
        summary: backfillSceneAppExecutionSummaryViewModel({
          summary: baseSummary,
          run: matchedRun,
          scorecard: snapshot.scorecard,
        }),
        latestPackResultDetailView: latestPackResultRun
          ? buildSceneAppExecutionSummaryRunDetailViewModel({
              summary: baseSummary,
              run: latestPackResultRun,
            })
          : null,
        latestPackResultUsesFallback:
          Boolean(latestPackResultRun) &&
          latestPackResultRun?.runId !== matchedRun?.runId,
        reviewTargetRunSummary: latestPackResultRun ?? matchedRun ?? null,
        loading: false,
        requestRefresh,
      });

      if (
        shouldContinuePolling({
          sessionId: normalizedSessionId,
          run: matchedRun,
          isSending,
        })
      ) {
        pollTimer = setTimeout(refresh, SCENEAPP_RUNTIME_POLL_INTERVAL_MS);
      }
    };

    void refresh();

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  }, [initialSummary, isSending, refreshNonce, requestRefresh, sessionId]);

  return useMemo(
    () => ({
      ...state,
      requestRefresh,
    }),
    [requestRefresh, state],
  );
}
