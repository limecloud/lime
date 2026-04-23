import { safeInvoke } from "@/lib/dev-bridge";
import { readSceneAppDirectorySessionReadyCompat } from "@/lib/sceneapp";
import type { AutomationCycleResult } from "./automation";
import type {
  SceneAppAutomationIntent,
  SceneAppCatalog,
  SceneAppCompatBindingFamily,
  SceneAppCompatCatalogInput,
  SceneAppCompatDescriptorInput,
  SceneAppCompatLaunchRequirementInput,
  SceneAppCompatPlanResultInput,
  SceneAppCompatRuntimeAction,
  SceneAppDescriptor,
  SceneAppExecutionRuntimeAction,
  SceneAppExecutorBindingFamily,
  SceneAppGovernanceArtifactKind,
  SceneAppLaunchIntent,
  SceneAppLaunchRequirement,
  SceneAppPlanResult,
  SceneAppRunSummary,
  SceneAppScorecard,
  SceneAppType,
} from "@/lib/sceneapp";

export type {
  SceneAppBindingFamily,
  ContextCompilerPlan,
  ContextLayerSnapshot,
  ReferenceItem,
  SceneAppBrowserRuntimeRef,
  SceneAppCatalog,
  SceneAppCompatCatalogInput,
  SceneAppCompatDescriptorInput,
  SceneAppCompatExecutionPlanInput,
  SceneAppCompatPlanResultInput,
  SceneAppServiceSceneRuntimeRef,
  SceneAppContextOverlay,
  SceneAppAutomationIntent,
  SceneAppDeliveryContract,
  SceneAppDescriptor,
  SceneAppExecutionRuntimeAction,
  SceneAppExecutorBindingFamily,
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

type SceneAppCompatOrNormalizedBindingFamily =
  | SceneAppExecutorBindingFamily
  | SceneAppCompatBindingFamily;

type SceneAppCompatOrNormalizedRuntimeAction =
  | SceneAppExecutionRuntimeAction
  | SceneAppCompatRuntimeAction;

function normalizeCompatSceneAppBindingFamily(
  bindingFamily: SceneAppCompatOrNormalizedBindingFamily,
): SceneAppExecutorBindingFamily {
  return bindingFamily === "cloud_scene" ? "agent_turn" : bindingFamily;
}

function isSceneAppCompatOrExecutorBindingFamily(
  value: string,
): value is SceneAppCompatOrNormalizedBindingFamily {
  return (
    value === "agent_turn" ||
    value === "browser_assist" ||
    value === "automation_job" ||
    value === "native_skill" ||
    value === "cloud_scene"
  );
}

function normalizeCompatSceneAppCapabilityRef(capabilityRef: string): string {
  return capabilityRef === "cloud_scene" ? "agent_turn" : capabilityRef;
}

function collectNormalizedSceneAppBindingFamilies(
  descriptor: Pick<
    SceneAppCompatDescriptorInput,
    "capabilityRefs" | "infraProfile" | "entryBindings" | "compositionProfile"
  >,
): SceneAppExecutorBindingFamily[] {
  const compositionSteps = Array.isArray(descriptor.compositionProfile?.steps)
    ? descriptor.compositionProfile.steps
    : [];

  return Array.from(
    new Set<SceneAppExecutorBindingFamily>([
      ...(Array.isArray(descriptor.entryBindings)
        ? descriptor.entryBindings
        : []
      ).map((binding) =>
        normalizeCompatSceneAppBindingFamily(binding.bindingFamily),
      ),
      ...compositionSteps
        .map((step) =>
          step.bindingFamily
            ? normalizeCompatSceneAppBindingFamily(step.bindingFamily)
            : undefined,
        )
        .filter(
          (
            bindingFamily,
          ): bindingFamily is SceneAppExecutorBindingFamily =>
            Boolean(bindingFamily),
        ),
      ...(Array.isArray(descriptor.capabilityRefs)
        ? descriptor.capabilityRefs
        : []
      )
        .filter(isSceneAppCompatOrExecutorBindingFamily)
        .map(normalizeCompatSceneAppBindingFamily),
      ...(Array.isArray(descriptor.infraProfile)
        ? descriptor.infraProfile
        : []
      )
        .filter(isSceneAppCompatOrExecutorBindingFamily)
        .map(normalizeCompatSceneAppBindingFamily),
    ]),
  );
}

function normalizeCompatSceneAppType(
  descriptor: SceneAppCompatDescriptorInput,
): SceneAppType {
  if (
    descriptor.sceneappType === "local_instant" ||
    descriptor.sceneappType === "local_durable" ||
    descriptor.sceneappType === "browser_grounded" ||
    descriptor.sceneappType === "hybrid"
  ) {
    return descriptor.sceneappType;
  }

  const capabilityRefs = Array.isArray(descriptor.capabilityRefs)
    ? descriptor.capabilityRefs
    : [];
  const infraProfile = Array.isArray(descriptor.infraProfile)
    ? descriptor.infraProfile
    : [];
  const bindingFamilies = collectNormalizedSceneAppBindingFamilies(descriptor);
  if (bindingFamilies.length > 1) {
    return "hybrid";
  }

  const primaryBindingFamily = bindingFamilies[0];
  if (primaryBindingFamily === "automation_job") {
    return "local_durable";
  }
  if (primaryBindingFamily === "browser_assist") {
    return "browser_grounded";
  }
  if (
    infraProfile.includes("automation_schedule") ||
    infraProfile.includes("db_store")
  ) {
    return "local_durable";
  }
  if (
    infraProfile.includes("browser_connector") ||
    capabilityRefs.includes("browser_assist")
  ) {
    return "browser_grounded";
  }
  if ((descriptor.compositionProfile?.steps?.length ?? 0) > 1) {
    return "hybrid";
  }

  return "local_instant";
}

function normalizeCompatSceneAppRuntimeAction(
  runtimeAction: SceneAppCompatOrNormalizedRuntimeAction,
): SceneAppExecutionRuntimeAction {
  return runtimeAction === "launch_cloud_scene"
    ? "open_service_scene_session"
    : runtimeAction;
}

function normalizeCompatSceneAppToolRefs(toolRefs: string[]): string[] {
  return dedupeStrings(
    toolRefs
      .filter((toolRef) => toolRef !== "cloud_session")
      .map(normalizeCompatSceneAppCapabilityRef),
  );
}

function isSceneAppNormalizedLaunchRequirement(
  requirement: SceneAppCompatLaunchRequirementInput,
): requirement is SceneAppLaunchRequirement {
  return requirement.kind !== "cloud_session";
}

function normalizeCompatSceneAppLaunchRequirements(
  requirements: SceneAppCompatLaunchRequirementInput[],
): SceneAppLaunchRequirement[] {
  return requirements.filter(isSceneAppNormalizedLaunchRequirement);
}

function normalizeSceneAppDescriptor(
  descriptor: SceneAppCompatDescriptorInput,
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
    sceneappType: normalizeCompatSceneAppType(descriptor),
    capabilityRefs: dedupeStrings(
      capabilityRefs.map(normalizeCompatSceneAppCapabilityRef),
    ),
    infraProfile: dedupeStrings(
      infraProfile
        .filter((item) => item !== "cloud_runtime")
        .map(normalizeCompatSceneAppCapabilityRef),
    ),
    launchRequirements: normalizeCompatSceneAppLaunchRequirements(
      Array.isArray(descriptor.launchRequirements)
        ? descriptor.launchRequirements
        : [],
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

function normalizeSceneAppReadiness(
  readiness: SceneAppCompatPlanResultInput["readiness"],
): SceneAppPlanResult["readiness"] {
  const unmetRequirements = normalizeCompatSceneAppLaunchRequirements(
    Array.isArray(readiness.unmetRequirements)
      ? readiness.unmetRequirements
      : [],
  );

  return {
    ...readiness,
    ready: unmetRequirements.length === 0,
    unmetRequirements,
  };
}

function normalizeSceneAppContextOverlay(
  contextOverlay: SceneAppCompatPlanResultInput["contextOverlay"],
): SceneAppCompatPlanResultInput["contextOverlay"] {
  if (!contextOverlay) {
    return contextOverlay;
  }

  return {
    ...contextOverlay,
    compilerPlan: {
      ...contextOverlay.compilerPlan,
      toolRefs: normalizeCompatSceneAppToolRefs(
        Array.isArray(contextOverlay.compilerPlan.toolRefs)
          ? contextOverlay.compilerPlan.toolRefs
          : [],
      ),
    },
    snapshot: {
      ...contextOverlay.snapshot,
      toolRefs: normalizeCompatSceneAppToolRefs(
        Array.isArray(contextOverlay.snapshot.toolRefs)
          ? contextOverlay.snapshot.toolRefs
          : [],
      ),
    },
  };
}

function normalizeSceneAppPlanResult(
  result: SceneAppCompatPlanResultInput,
): SceneAppPlanResult {
  return {
    ...result,
    descriptor: normalizeSceneAppDescriptor(result.descriptor),
    readiness: normalizeSceneAppReadiness(result.readiness),
    contextOverlay: normalizeSceneAppContextOverlay(result.contextOverlay),
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

function normalizeSceneAppRuntimeContextForInvoke(
  runtimeContext: SceneAppLaunchIntent["runtimeContext"],
) {
  if (!runtimeContext) {
    return undefined;
  }

  const normalized = {
    ...runtimeContext,
  } as Record<string, unknown>;
  const directorySessionReadyCompat =
    readSceneAppDirectorySessionReadyCompat(runtimeContext);

  delete normalized.directorySessionReadyCompat;

  if (directorySessionReadyCompat !== undefined) {
    normalized.cloudSessionReady = directorySessionReadyCompat;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeSceneAppLaunchIntentForInvoke(intent: SceneAppLaunchIntent) {
  const runtimeContext = normalizeSceneAppRuntimeContextForInvoke(
    intent.runtimeContext,
  );

  return runtimeContext
    ? {
        ...intent,
        runtimeContext,
      }
    : intent;
}

export async function listSceneAppCatalog(): Promise<SceneAppCatalog> {
  const catalog = await safeInvoke<SceneAppCompatCatalogInput>(
    "sceneapp_list_catalog",
  );
  return normalizeSceneAppCatalogProjection(catalog);
}

export function normalizeSceneAppCatalogProjection(
  catalog: SceneAppCompatCatalogInput,
): SceneAppCatalog {
  return {
    ...catalog,
    items: catalog.items.map(normalizeSceneAppDescriptor),
  };
}

export async function getSceneAppDescriptor(
  id: string,
): Promise<SceneAppDescriptor | null> {
  const descriptor = await safeInvoke<SceneAppCompatDescriptorInput | null>(
    "sceneapp_get_descriptor",
    { id },
  );
  return descriptor ? normalizeSceneAppDescriptor(descriptor) : null;
}

export async function planSceneAppLaunch(
  intent: SceneAppLaunchIntent,
): Promise<SceneAppPlanResult> {
  const result = await safeInvoke<SceneAppCompatPlanResultInput>(
    "sceneapp_plan_launch",
    {
      intent: normalizeSceneAppLaunchIntentForInvoke(intent),
    },
  );
  return normalizeSceneAppPlanResult(result);
}

export async function saveSceneAppContextBaseline(
  intent: SceneAppLaunchIntent,
): Promise<SceneAppPlanResult> {
  const result = await safeInvoke<SceneAppCompatPlanResultInput>(
    "sceneapp_save_context_baseline",
    { intent: normalizeSceneAppLaunchIntentForInvoke(intent) },
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
  return safeInvoke("sceneapp_create_automation_job", {
    intent: {
      ...intent,
      launchIntent: normalizeSceneAppLaunchIntentForInvoke(intent.launchIntent),
    },
  });
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
