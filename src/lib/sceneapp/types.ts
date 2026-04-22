import type {
  ServiceSkillAnyExecutorBinding,
  ServiceSkillCompatExecutorBinding,
  ServiceSkillCurrentExecutorBinding,
} from "@/lib/api/serviceSkills";
import type {
  AutomationExecutionMode,
  DeliveryConfig,
  TaskSchedule,
} from "@/lib/api/automation";
import type { BaseSetupViewerKind } from "@/lib/base-setup/types";
import type {
  SceneAppContextOverlay,
} from "@/lib/context-layer";

export type {
  ContextCompilerPlan,
  ContextLayerSnapshot,
  ReferenceItem,
  SceneAppContextOverlay,
  TasteProfile,
} from "@/lib/context-layer";

export type SceneAppCurrentType =
  | "local_instant"
  | "local_durable"
  | "browser_grounded"
  | "hybrid";

// legacy compat only：旧目录可能仍返回 cloud_managed，但 current 页面状态不应再主动写出它。
export type SceneAppCompatType = "cloud_managed";
export type SceneAppType = SceneAppCurrentType;

export type SceneAppPattern =
  | "pipeline"
  | "generator"
  | "reviewer"
  | "inversion"
  | "tool_wrapper";

export type SceneAppCurrentBindingFamily = ServiceSkillCurrentExecutorBinding;
export type SceneAppCompatBindingFamily = ServiceSkillCompatExecutorBinding;
export type SceneAppBindingFamily = ServiceSkillAnyExecutorBinding;

export type SceneAppDeliveryContract =
  | "artifact_bundle"
  | "project_pack"
  | "table_report";

export type SceneAppCurrentLaunchRequirementKind =
  | "user_input"
  | "project"
  | "browser_session"
  | "automation";

export type SceneAppCompatLaunchRequirementKind =
  // legacy compat only：current 启动前置不再把云端运行时当成可执行门槛。
  "cloud_session";

export type SceneAppLaunchRequirementKind =
  | SceneAppCurrentLaunchRequirementKind
  | SceneAppCompatLaunchRequirementKind;

export type SceneAppEntryBindingKind =
  | "service_skill"
  | "scene"
  | "mention"
  | "workspace_card";

export interface SceneAppEntryBinding {
  kind: SceneAppEntryBindingKind;
  bindingFamily: SceneAppBindingFamily;
  serviceSkillId?: string;
  skillKey?: string;
  sceneKey?: string;
  commandPrefix?: string;
  aliases?: string[];
}

export interface SceneAppLaunchRequirement {
  kind: SceneAppLaunchRequirementKind;
  message: string;
}

export interface SceneAppDeliveryProfile {
  artifactProfileRef?: string;
  viewerKind?: BaseSetupViewerKind;
  requiredParts: string[];
  primaryPart?: string;
}

export interface SceneAppCompositionStepDescriptor {
  id: string;
  order: number;
  bindingProfileRef?: string;
  bindingFamily?: SceneAppBindingFamily;
}

export interface SceneAppCompositionProfile {
  blueprintRef?: string;
  stepCount: number;
  steps: SceneAppCompositionStepDescriptor[];
}

export interface SceneAppScorecardProfile {
  profileRef?: string;
  metricKeys: string[];
  failureSignals: string[];
}

export interface SceneAppDescriptor {
  id: string;
  title: string;
  summary: string;
  category: string;
  sceneappType: SceneAppType;
  patternPrimary: SceneAppPattern;
  patternStack: SceneAppPattern[];
  capabilityRefs: string[];
  infraProfile: string[];
  deliveryContract: SceneAppDeliveryContract;
  artifactKind?: string;
  outputHint: string;
  entryBindings: SceneAppEntryBinding[];
  launchRequirements: SceneAppLaunchRequirement[];
  linkedServiceSkillId?: string;
  linkedSceneKey?: string;
  deliveryProfile?: SceneAppDeliveryProfile;
  compositionProfile?: SceneAppCompositionProfile;
  scorecardProfile?: SceneAppScorecardProfile;
  aliases?: string[];
  sourcePackageId: string;
  sourcePackageVersion: string;
}

export interface SceneAppCatalog {
  version: string;
  generatedAt: string;
  items: SceneAppDescriptor[];
}

export interface SceneAppRuntimeContext {
  browserSessionAttached?: boolean;
  automationEnabled?: boolean;
  // current 内部语义：仅表示“旧目录会话兼容位”是否已就绪，不再代表任何当前云执行前置。
  directorySessionReadyCompat?: boolean;
}

export interface SceneAppCompatRuntimeContextInput {
  // legacy compat only：真实 wire 合同与历史调用方仍可能继续发旧字段名，只允许作为兼容输入。
  cloudSessionReady?: boolean;
  cloud_session_ready?: unknown;
}

export function readSceneAppDirectorySessionReadyCompat(
  runtimeContext:
    | (Partial<SceneAppRuntimeContext> & SceneAppCompatRuntimeContextInput)
    | null
    | undefined,
): boolean | undefined {
  if (!runtimeContext || typeof runtimeContext !== "object") {
    return undefined;
  }

  if (typeof runtimeContext.directorySessionReadyCompat === "boolean") {
    return runtimeContext.directorySessionReadyCompat;
  }

  if (typeof runtimeContext.cloudSessionReady === "boolean") {
    return runtimeContext.cloudSessionReady;
  }

  if (typeof runtimeContext.cloud_session_ready === "boolean") {
    return runtimeContext.cloud_session_ready;
  }

  return undefined;
}

export interface SceneAppLaunchIntent {
  sceneappId: string;
  entrySource?: string;
  workspaceId?: string;
  projectId?: string;
  userInput?: string;
  referenceMemoryIds?: string[];
  slots?: Record<string, string>;
  runtimeContext?: SceneAppRuntimeContext;
}

export interface SceneAppExecutionPlanStep {
  id: string;
  title: string;
  bindingFamily: SceneAppBindingFamily;
}

export type SceneAppCurrentRuntimeAction =
  | "submit_agent_turn"
  | "launch_browser_assist"
  | "create_automation_job"
  | "open_service_scene_session"
  | "launch_native_skill";

export type SceneAppCompatRuntimeAction =
  // legacy compat only：允许继续读取旧 planner 输出，但 current 主链统一改回 service_scene 命名。
  "launch_cloud_scene";

export type SceneAppRuntimeAction =
  | SceneAppCurrentRuntimeAction
  | SceneAppCompatRuntimeAction;

export interface SceneAppRuntimeAdapterPlan {
  adapterKind: SceneAppBindingFamily;
  runtimeAction: SceneAppRuntimeAction;
  targetRef: string;
  targetLabel: string;
  linkedServiceSkillId?: string;
  linkedSceneKey?: string;
  preferredProfileKey?: string;
  requestMetadata: Record<string, unknown>;
  launchPayload: Record<string, unknown>;
  notes: string[];
}

export interface SceneAppExecutionPlan {
  sceneappId: string;
  executorKind: SceneAppBindingFamily;
  bindingFamily: SceneAppBindingFamily;
  stepPlan: SceneAppExecutionPlanStep[];
  adapterPlan: SceneAppRuntimeAdapterPlan;
  storageStrategy: string;
  artifactContract: SceneAppDeliveryContract;
  governanceHooks: string[];
  warnings: string[];
}

export interface SceneAppReadiness {
  ready: boolean;
  unmetRequirements: SceneAppLaunchRequirement[];
}

export interface SceneAppProjectPackPlan {
  packKind: SceneAppDeliveryContract;
  primaryPart?: string;
  requiredParts: string[];
  viewerKind?: BaseSetupViewerKind;
  completionStrategy: string;
  notes: string[];
}

export interface SceneAppPlanResult {
  descriptor: SceneAppDescriptor;
  readiness: SceneAppReadiness;
  plan: SceneAppExecutionPlan;
  contextOverlay?: SceneAppContextOverlay;
  projectPackPlan?: SceneAppProjectPackPlan;
}

export type SceneAppCurrentEntryBinding = Omit<
  SceneAppEntryBinding,
  "bindingFamily"
> & {
  bindingFamily: SceneAppCurrentBindingFamily;
};

export type SceneAppCurrentLaunchRequirement = Omit<
  SceneAppLaunchRequirement,
  "kind"
> & {
  kind: SceneAppCurrentLaunchRequirementKind;
};

export type SceneAppCurrentCompositionStepDescriptor = Omit<
  SceneAppCompositionStepDescriptor,
  "bindingFamily"
> & {
  bindingFamily?: SceneAppCurrentBindingFamily;
};

export type SceneAppCurrentCompositionProfile = Omit<
  SceneAppCompositionProfile,
  "steps"
> & {
  steps: SceneAppCurrentCompositionStepDescriptor[];
};

export type SceneAppCurrentDescriptor = Omit<
  SceneAppDescriptor,
  "entryBindings" | "launchRequirements" | "compositionProfile"
> & {
  entryBindings: SceneAppCurrentEntryBinding[];
  launchRequirements: SceneAppCurrentLaunchRequirement[];
  compositionProfile?: SceneAppCurrentCompositionProfile;
};

export type SceneAppCurrentCatalog = Omit<SceneAppCatalog, "items"> & {
  items: SceneAppCurrentDescriptor[];
};

export type SceneAppCurrentExecutionPlanStep = Omit<
  SceneAppExecutionPlanStep,
  "bindingFamily"
> & {
  bindingFamily: SceneAppCurrentBindingFamily;
};

export type SceneAppCurrentRuntimeAdapterPlan = Omit<
  SceneAppRuntimeAdapterPlan,
  "adapterKind" | "runtimeAction"
> & {
  adapterKind: SceneAppCurrentBindingFamily;
  runtimeAction: SceneAppCurrentRuntimeAction;
};

export type SceneAppCurrentExecutionPlan = Omit<
  SceneAppExecutionPlan,
  "executorKind" | "bindingFamily" | "stepPlan" | "adapterPlan"
> & {
  executorKind: SceneAppCurrentBindingFamily;
  bindingFamily: SceneAppCurrentBindingFamily;
  stepPlan: SceneAppCurrentExecutionPlanStep[];
  adapterPlan: SceneAppCurrentRuntimeAdapterPlan;
};

export type SceneAppCurrentReadiness = Omit<
  SceneAppReadiness,
  "unmetRequirements"
> & {
  unmetRequirements: SceneAppCurrentLaunchRequirement[];
};

export type SceneAppCurrentPlanResult = Omit<
  SceneAppPlanResult,
  "descriptor" | "readiness" | "plan"
> & {
  descriptor: SceneAppCurrentDescriptor;
  readiness: SceneAppCurrentReadiness;
  plan: SceneAppCurrentExecutionPlan;
};

export interface SceneAppAutomationIntent {
  launchIntent: SceneAppLaunchIntent;
  name?: string;
  description?: string | null;
  schedule?: TaskSchedule;
  enabled?: boolean;
  executionMode?: AutomationExecutionMode;
  delivery?: DeliveryConfig;
  timeoutSecs?: number | null;
  maxRetries?: number;
  runNow?: boolean;
}

export interface SceneAppBrowserRuntimeRef {
  profileKey?: string | null;
  sessionId?: string | null;
  targetId?: string | null;
}

export interface SceneAppServiceSceneRuntimeRef {
  sceneKey?: string | null;
  skillId?: string | null;
  projectId?: string | null;
  contentId?: string | null;
  workspaceId?: string | null;
  entrySource?: string | null;
  userInput?: string | null;
  slots?: Record<string, string>;
}

export interface SceneAppNativeSkillRuntimeRef {
  skillId?: string | null;
  skillKey?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
  userInput?: string | null;
  slots?: Record<string, string>;
}

export interface SceneAppDeliveryArtifactRef {
  relativePath: string;
  absolutePath?: string | null;
  partKey?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
  source: string;
}

export type SceneAppGovernanceArtifactKind =
  | "evidence_summary"
  | "review_decision_markdown"
  | "review_decision_json";

export interface SceneAppGovernanceArtifactRef {
  kind: SceneAppGovernanceArtifactKind;
  label: string;
  relativePath: string;
  absolutePath?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
  source: string;
}

export interface SceneAppRunSummary {
  runId: string;
  sceneappId: string;
  status: "queued" | "running" | "success" | "error" | "canceled" | "timeout";
  source: "chat" | "skill" | "automation" | "catalog_seed";
  sourceRef?: string | null;
  sessionId?: string | null;
  browserRuntimeRef?: SceneAppBrowserRuntimeRef | null;
  serviceSceneRuntimeRef?: SceneAppServiceSceneRuntimeRef | null;
  nativeSkillRuntimeRef?: SceneAppNativeSkillRuntimeRef | null;
  startedAt: string;
  finishedAt?: string | null;
  artifactCount: number;
  deliveryArtifactRefs?: SceneAppDeliveryArtifactRef[];
  governanceArtifactRefs?: SceneAppGovernanceArtifactRef[];
  deliveryRequiredParts?: string[];
  deliveryCompletedParts?: string[];
  deliveryMissingParts?: string[];
  deliveryCompletionRate?: number | null;
  deliveryPartCoverageKnown?: boolean;
  failureSignal?: string | null;
  runtimeEvidenceUsed?: boolean;
  evidenceKnownGaps?: string[];
  verificationFailureOutcomes?: string[];
  requestTelemetryAvailable?: boolean | null;
  requestTelemetryMatchedCount?: number | null;
  artifactValidatorApplicable?: boolean | null;
  artifactValidatorIssueCount?: number | null;
  artifactValidatorRecoveredCount?: number | null;
}

export interface SceneAppScorecardMetric {
  key: string;
  label: string;
  value: number;
  status: "good" | "watch" | "risk";
}

export interface SceneAppScorecard {
  sceneappId: string;
  updatedAt: string;
  summary: string;
  metrics: SceneAppScorecardMetric[];
  recommendedAction: "launch" | "keep" | "optimize" | "retire";
  observedFailureSignals?: string[];
  topFailureSignal?: string | null;
}
