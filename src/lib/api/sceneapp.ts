import { safeInvoke } from "@/lib/dev-bridge";
import type { AutomationCycleResult } from "./automation";
import type {
  SceneAppCatalog,
  SceneAppAutomationIntent,
  SceneAppDescriptor,
  SceneAppGovernanceArtifactKind,
  SceneAppLaunchIntent,
  SceneAppPlanResult,
  SceneAppRunSummary,
  SceneAppScorecard,
} from "@/lib/sceneapp";

export type {
  SceneAppBindingFamily,
  SceneAppBrowserRuntimeRef,
  SceneAppCatalog,
  SceneAppCloudSceneRuntimeRef,
  SceneAppAutomationIntent,
  SceneAppDeliveryContract,
  SceneAppDescriptor,
  SceneAppGovernanceArtifactKind,
  SceneAppExecutionPlan,
  SceneAppExecutionPlanStep,
  SceneAppLaunchIntent,
  SceneAppLaunchRequirement,
  SceneAppPattern,
  SceneAppPlanResult,
  SceneAppReadiness,
  SceneAppNativeSkillRuntimeRef,
  SceneAppRunSummary,
  SceneAppRuntimeAction,
  SceneAppRuntimeAdapterPlan,
  SceneAppRuntimeContext,
  SceneAppScorecard,
  SceneAppScorecardMetric,
  SceneAppType,
} from "@/lib/sceneapp";

export async function listSceneAppCatalog(): Promise<SceneAppCatalog> {
  return safeInvoke("sceneapp_list_catalog");
}

export async function getSceneAppDescriptor(
  id: string,
): Promise<SceneAppDescriptor | null> {
  return safeInvoke("sceneapp_get_descriptor", { id });
}

export async function planSceneAppLaunch(
  intent: SceneAppLaunchIntent,
): Promise<SceneAppPlanResult> {
  return safeInvoke("sceneapp_plan_launch", { intent });
}

export type SceneAppAutomationRunResult = AutomationCycleResult;

export interface SceneAppAutomationResult {
  sceneappId: string;
  jobId: string;
  jobName: string;
  enabled: boolean;
  workspaceId: string;
  nextRunAt?: string | null;
  runNowResult?: SceneAppAutomationRunResult | null;
}

export async function createSceneAppAutomationJob(
  intent: SceneAppAutomationIntent,
): Promise<SceneAppAutomationResult> {
  return safeInvoke("sceneapp_create_automation_job", { intent });
}

export async function listSceneAppRuns(
  sceneappId?: string,
): Promise<SceneAppRunSummary[]> {
  return safeInvoke("sceneapp_list_runs", { sceneappId });
}

export async function getSceneAppRunSummary(
  runId: string,
): Promise<SceneAppRunSummary | null> {
  return safeInvoke("sceneapp_get_run_summary", { runId });
}

export async function prepareSceneAppRunGovernanceArtifact(
  runId: string,
  kind: SceneAppGovernanceArtifactKind,
): Promise<SceneAppRunSummary | null> {
  return safeInvoke("sceneapp_prepare_run_governance_artifact", {
    runId,
    kind,
  });
}

export async function prepareSceneAppRunGovernanceArtifacts(
  runId: string,
  kinds: SceneAppGovernanceArtifactKind[],
): Promise<SceneAppRunSummary | null> {
  const normalizedKinds = Array.from(
    new Set(kinds.map((kind) => kind.trim()).filter(Boolean)),
  ) as SceneAppGovernanceArtifactKind[];
  let latestSummary: SceneAppRunSummary | null = null;

  for (const kind of normalizedKinds) {
    latestSummary = await prepareSceneAppRunGovernanceArtifact(runId, kind);
    if (!latestSummary) {
      return null;
    }
  }

  return latestSummary;
}

export async function getSceneAppScorecard(
  sceneappId: string,
): Promise<SceneAppScorecard> {
  return safeInvoke("sceneapp_get_scorecard", { sceneappId });
}
