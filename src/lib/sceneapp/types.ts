import type { ServiceSkillExecutorBinding } from "@/lib/api/serviceSkills";
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

export type SceneAppType =
  | "local_instant"
  | "local_durable"
  | "browser_grounded"
  | "cloud_managed"
  | "hybrid";

export type SceneAppPattern =
  | "pipeline"
  | "generator"
  | "reviewer"
  | "inversion"
  | "tool_wrapper";

export type SceneAppBindingFamily = ServiceSkillExecutorBinding;

export type SceneAppDeliveryContract =
  | "artifact_bundle"
  | "project_pack"
  | "table_report";

export type SceneAppLaunchRequirementKind =
  | "user_input"
  | "project"
  | "browser_session"
  | "automation"
  // legacy compat only：current 启动前置不再把云端运行时当成可执行门槛。
  | "cloud_session";

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
  // legacy compat only：current 本地执行面不再依赖云端 session，就算远端还回旧字段，也只允许作为兼容输入。
  cloudSessionReady?: boolean;
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
