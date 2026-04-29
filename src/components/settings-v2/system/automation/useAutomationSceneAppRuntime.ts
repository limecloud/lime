import { useEffect, useMemo, useState } from "react";
import type { AutomationJobRecord } from "@/lib/api/automation";
import type { AgentRun } from "@/lib/api/executionRun";
import {
  getSceneAppDescriptor,
  getSceneAppRunSummary,
  getSceneAppScorecard,
  listSceneAppRuns,
  planSceneAppLaunch,
  type SceneAppDescriptor,
  type SceneAppPlanResult,
  type SceneAppRunSummary,
  type SceneAppScorecard,
} from "@/lib/api/sceneapp";
import {
  buildSceneAppLaunchIntentFromAutomationContext,
  formatSceneAppErrorMessage,
  resolveSceneAppAutomationContext,
  type SceneAppAutomationContext,
} from "@/lib/sceneapp";
import { resolveRunSessionId } from "./automationPresentation";

interface UseAutomationSceneAppRuntimeParams {
  job: AutomationJobRecord | null;
  jobRuns: AgentRun[];
  enabled?: boolean;
}

export interface AutomationSceneAppRuntimeState {
  sceneAppContext: SceneAppAutomationContext | null;
  descriptor: SceneAppDescriptor | null;
  scorecard: SceneAppScorecard | null;
  planResult: SceneAppPlanResult | null;
  linkedRun: SceneAppRunSummary | null;
  setLinkedRun: (run: SceneAppRunSummary | null) => void;
  loading: boolean;
  error: string | null;
}

function normalizeOptionalText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function resolveLinkedSceneAppRun(params: {
  job: AutomationJobRecord;
  jobRuns: AgentRun[];
  sceneAppRuns: SceneAppRunSummary[];
}): SceneAppRunSummary | null {
  const { job, jobRuns, sceneAppRuns } = params;
  const lastDeliveryRunId = normalizeOptionalText(job.last_delivery?.run_id);
  if (lastDeliveryRunId) {
    const matched = sceneAppRuns.find((run) => run.runId === lastDeliveryRunId);
    if (matched) {
      return matched;
    }
  }

  const jobRunIds = new Set(
    jobRuns
      .map((run) => normalizeOptionalText(run.id))
      .filter((value): value is string => Boolean(value)),
  );
  const sessionIds = new Set(
    jobRuns
      .map((run) => normalizeOptionalText(resolveRunSessionId(run)))
      .filter((value): value is string => Boolean(value)),
  );

  return (
    sceneAppRuns.find((run) => jobRunIds.has(run.runId)) ??
    sceneAppRuns.find((run) => {
      const sessionId = normalizeOptionalText(run.sessionId);
      return Boolean(sessionId && sessionIds.has(sessionId));
    }) ??
    sceneAppRuns.find(
      (run) =>
        normalizeOptionalText(run.sourceRef) === job.id &&
        !run.runId.startsWith("automation-job:"),
    ) ??
    sceneAppRuns.find(
      (run) => normalizeOptionalText(run.sourceRef) === job.id,
    ) ??
    null
  );
}

export function useAutomationSceneAppRuntime({
  job,
  jobRuns,
  enabled = true,
}: UseAutomationSceneAppRuntimeParams): AutomationSceneAppRuntimeState {
  const sceneAppContext = useMemo(
    () => (job ? resolveSceneAppAutomationContext(job.payload) : null),
    [job],
  );
  const [descriptor, setDescriptor] = useState<SceneAppDescriptor | null>(null);
  const [scorecard, setScorecard] = useState<SceneAppScorecard | null>(null);
  const [planResult, setPlanResult] = useState<SceneAppPlanResult | null>(null);
  const [linkedRun, setLinkedRun] = useState<SceneAppRunSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !job || !sceneAppContext) {
      setDescriptor(null);
      setScorecard(null);
      setPlanResult(null);
      setLinkedRun(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDescriptor(null);
    setScorecard(null);
    setPlanResult(null);
    setLinkedRun(null);

    void (async () => {
      const launchIntent =
        buildSceneAppLaunchIntentFromAutomationContext(sceneAppContext);
      const [descriptorResult, scorecardResult, runsResult, planResultState] =
        await Promise.allSettled([
          getSceneAppDescriptor(sceneAppContext.sceneappId),
          getSceneAppScorecard(sceneAppContext.sceneappId),
          listSceneAppRuns(sceneAppContext.sceneappId),
          planSceneAppLaunch(launchIntent),
        ]);

      if (cancelled) {
        return;
      }

      const nextDescriptor =
        descriptorResult.status === "fulfilled" ? descriptorResult.value : null;
      if (!nextDescriptor) {
        setDescriptor(null);
        setScorecard(null);
        setPlanResult(null);
        setLinkedRun(null);
        setLoading(false);
        setError(
          descriptorResult.status === "rejected"
            ? formatSceneAppErrorMessage(descriptorResult.reason)
            : "当前这条持续流程关联的做法已不存在。",
        );
        return;
      }

      const sceneAppRuns =
        runsResult.status === "fulfilled" ? runsResult.value : [];
      const linkedRunCandidate = resolveLinkedSceneAppRun({
        job,
        jobRuns,
        sceneAppRuns,
      });

      let nextLinkedRun = linkedRunCandidate;
      if (
        linkedRunCandidate &&
        !linkedRunCandidate.runId.startsWith("automation-job:")
      ) {
        try {
          const detailedRun = await getSceneAppRunSummary(
            linkedRunCandidate.runId,
          );
          if (detailedRun) {
            nextLinkedRun = detailedRun;
          }
        } catch {
          nextLinkedRun = linkedRunCandidate;
        }
      }

      if (cancelled) {
        return;
      }

      const partialErrors = [
        scorecardResult.status === "rejected"
          ? formatSceneAppErrorMessage(scorecardResult.reason)
          : null,
        runsResult.status === "rejected"
          ? formatSceneAppErrorMessage(runsResult.reason)
          : null,
        planResultState.status === "rejected"
          ? formatSceneAppErrorMessage(planResultState.reason)
          : null,
      ].filter((value): value is string => Boolean(value));

      setDescriptor(nextDescriptor);
      setScorecard(
        scorecardResult.status === "fulfilled" ? scorecardResult.value : null,
      );
      setPlanResult(
        planResultState.status === "fulfilled" ? planResultState.value : null,
      );
      setLinkedRun(nextLinkedRun);
      setError(partialErrors[0] ?? null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, job, jobRuns, sceneAppContext]);

  return {
    sceneAppContext,
    descriptor,
    scorecard,
    planResult,
    linkedRun,
    setLinkedRun,
    loading,
    error,
  };
}
