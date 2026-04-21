import { safeInvoke } from "@/lib/dev-bridge";
import type { AutomationCycleResult } from "./automation";
import type {
  SceneAppCatalog,
  SceneAppAutomationIntent,
  SceneAppBindingFamily,
  SceneAppDescriptor,
  SceneAppGovernanceArtifactKind,
  SceneAppLaunchIntent,
  SceneAppPlanResult,
  SceneAppRunSummary,
  SceneAppRuntimeAction,
  SceneAppScorecard,
} from "@/lib/sceneapp";

export type {
  SceneAppBindingFamily,
  ContextCompilerPlan,
  ContextLayerSnapshot,
  ReferenceItem,
  SceneAppBrowserRuntimeRef,
  SceneAppCatalog,
  SceneAppServiceSceneRuntimeRef,
  SceneAppContextOverlay,
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
  SceneAppProjectPackPlan,
  SceneAppReadiness,
  SceneAppNativeSkillRuntimeRef,
  SceneAppRunSummary,
  SceneAppRuntimeAction,
  SceneAppRuntimeAdapterPlan,
  SceneAppRuntimeContext,
  SceneAppScorecard,
  SceneAppScorecardMetric,
  SceneAppType,
  TasteProfile,
} from "@/lib/sceneapp";

function dedupeStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeCompatSceneAppBindingFamily(
  bindingFamily: SceneAppBindingFamily,
): SceneAppBindingFamily {
  return bindingFamily === "cloud_scene" ? "agent_turn" : bindingFamily;
}

function normalizeCompatSceneAppCapabilityRef(capabilityRef: string): string {
  return capabilityRef === "cloud_scene" ? "agent_turn" : capabilityRef;
}

function normalizeCompatSceneAppRuntimeAction(
  runtimeAction: SceneAppRuntimeAction,
): SceneAppRuntimeAction {
  return runtimeAction === "launch_cloud_scene"
    ? "open_service_scene_session"
    : runtimeAction;
}

function normalizeSceneAppDescriptor(
  descriptor: SceneAppDescriptor,
): SceneAppDescriptor {
  const capabilityRefs = Array.isArray(descriptor.capabilityRefs)
    ? descriptor.capabilityRefs
    : [];
  const infraProfile = Array.isArray(descriptor.infraProfile)
    ? descriptor.infraProfile
    : [];
  const entryBindings = Array.isArray(descriptor.entryBindings)
    ? descriptor.entryBindings
    : [];
  const compositionSteps = Array.isArray(descriptor.compositionProfile?.steps)
    ? descriptor.compositionProfile.steps
    : [];

  return {
    ...descriptor,
    capabilityRefs: dedupeStrings(
      capabilityRefs.map(normalizeCompatSceneAppCapabilityRef),
    ),
    infraProfile: dedupeStrings(
      infraProfile
        .filter((item) => item !== "cloud_runtime")
        .map(normalizeCompatSceneAppCapabilityRef),
    ),
    entryBindings: entryBindings.map((binding) => ({
      ...binding,
      bindingFamily: normalizeCompatSceneAppBindingFamily(
        binding.bindingFamily,
      ),
    })),
    compositionProfile: descriptor.compositionProfile
      ? {
          ...descriptor.compositionProfile,
          steps: compositionSteps.map((step) => ({
            ...step,
            bindingFamily: step.bindingFamily
              ? normalizeCompatSceneAppBindingFamily(step.bindingFamily)
              : undefined,
          })),
        }
      : undefined,
  };
}

function normalizeSceneAppPlanResult(result: SceneAppPlanResult): SceneAppPlanResult {
  return {
    ...result,
    descriptor: normalizeSceneAppDescriptor(result.descriptor),
    plan: {
      ...result.plan,
      executorKind: normalizeCompatSceneAppBindingFamily(result.plan.executorKind),
      bindingFamily: normalizeCompatSceneAppBindingFamily(result.plan.bindingFamily),
      stepPlan: result.plan.stepPlan.map((step) => ({
        ...step,
        bindingFamily: normalizeCompatSceneAppBindingFamily(step.bindingFamily),
      })),
      adapterPlan: {
        ...result.plan.adapterPlan,
        adapterKind: normalizeCompatSceneAppBindingFamily(
          result.plan.adapterPlan.adapterKind,
        ),
        runtimeAction: normalizeCompatSceneAppRuntimeAction(
          result.plan.adapterPlan.runtimeAction,
        ),
      },
    },
  };
}

export async function listSceneAppCatalog(): Promise<SceneAppCatalog> {
  const catalog = await safeInvoke<SceneAppCatalog>("sceneapp_list_catalog");
  return {
    ...catalog,
    items: catalog.items.map(normalizeSceneAppDescriptor),
  };
}

export async function getSceneAppDescriptor(
  id: string,
): Promise<SceneAppDescriptor | null> {
  const descriptor = await safeInvoke<SceneAppDescriptor | null>(
    "sceneapp_get_descriptor",
    { id },
  );
  return descriptor ? normalizeSceneAppDescriptor(descriptor) : null;
}

export async function planSceneAppLaunch(
  intent: SceneAppLaunchIntent,
): Promise<SceneAppPlanResult> {
  const result = await safeInvoke<SceneAppPlanResult>("sceneapp_plan_launch", {
    intent,
  });
  return normalizeSceneAppPlanResult(result);
}

export async function saveSceneAppContextBaseline(
  intent: SceneAppLaunchIntent,
): Promise<SceneAppPlanResult> {
  const result = await safeInvoke<SceneAppPlanResult>(
    "sceneapp_save_context_baseline",
    { intent },
  );
  return normalizeSceneAppPlanResult(result);
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
