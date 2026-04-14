import type {
  ServiceSkillArtifactKind,
  ServiceSkillCatalog,
  ServiceSkillExecutionLocation,
  ServiceSkillExecutorBinding,
  ServiceSkillPromptTemplateKey,
  ServiceSkillReadinessRequirements,
  ServiceSkillRunnerType,
  ServiceSkillSceneBinding,
  ServiceSkillSiteCapabilityBinding,
  ServiceSkillSlotDefinition,
  ServiceSkillSource,
  ServiceSkillSurfaceScope,
  ServiceSkillType,
} from "@/lib/api/serviceSkills";

export const BASE_SETUP_TARGET_CATALOGS = [
  "skill_catalog",
  "service_skill_catalog",
  "scene_catalog",
  "command_catalog",
] as const;

export const BASE_SETUP_VIEWER_KINDS = [
  "artifact_bundle",
  "document",
  "table_report",
] as const;

export const BASE_SETUP_DELIVERY_CONTRACTS = [
  "artifact_bundle",
  "project_pack",
  "table_report",
] as const;

export const BASE_SETUP_POLICY_ROLLOUT_STAGES = [
  "seeded",
  "bootstrap",
  "limited",
  "general",
] as const;

export const BASE_SETUP_ALLOWED_BINDING_FAMILIES = [
  "agent_turn",
  "browser_assist",
  "automation_job",
  "cloud_scene",
  "native_skill",
] as const;

export const BASE_SETUP_ALLOWED_KERNEL_CAPABILITIES = [
  ...BASE_SETUP_ALLOWED_BINDING_FAMILIES,
  "workspace_storage",
  "artifact_viewer",
  "timeline",
] as const;

export type BaseSetupTargetCatalog =
  (typeof BASE_SETUP_TARGET_CATALOGS)[number];
export type BaseSetupViewerKind = (typeof BASE_SETUP_VIEWER_KINDS)[number];
export type BaseSetupDeliveryContract =
  (typeof BASE_SETUP_DELIVERY_CONTRACTS)[number];
export type BaseSetupPolicyRolloutStage =
  (typeof BASE_SETUP_POLICY_ROLLOUT_STAGES)[number];
export type BaseSetupAllowedBindingFamily =
  (typeof BASE_SETUP_ALLOWED_BINDING_FAMILIES)[number];
export type BaseSetupAllowedKernelCapability =
  (typeof BASE_SETUP_ALLOWED_KERNEL_CAPABILITIES)[number];

export interface BaseSetupBundleRef {
  id: string;
  source: "builtin" | "remote" | "local";
  pathOrUri: string;
  kind: "skill_bundle" | "local_bundle";
  versionConstraint?: string;
}

export interface BaseSetupSlotProfile {
  id: string;
  slots: ServiceSkillSlotDefinition[];
}

export interface BaseSetupBindingProfile {
  id: string;
  bindingFamily: ServiceSkillExecutorBinding;
  runnerType?: ServiceSkillRunnerType;
  executionLocation?: ServiceSkillExecutionLocation;
  capabilityRefs?: string[];
  timeoutSecs?: number;
  retryLimit?: number;
}

export interface BaseSetupArtifactProfile {
  id: string;
  deliveryContract: BaseSetupDeliveryContract;
  requiredParts: string[];
  viewerKind: BaseSetupViewerKind;
  defaultArtifactKind?: ServiceSkillArtifactKind;
  outputDestination?: string;
}

export interface BaseSetupScorecardProfile {
  id: string;
  metrics: string[];
  failureSignals?: string[];
}

export interface BaseSetupPolicyProfile {
  id: string;
  enabled?: boolean;
  surfaceScopes?: ServiceSkillSurfaceScope[];
  rolloutStage?: BaseSetupPolicyRolloutStage;
}

export interface BaseSetupCompositionDeliveryContract {
  requiredParts: string[];
}

export interface BaseSetupCompositionStep {
  id: string;
  bindingProfileRef?: string;
}

export interface BaseSetupCompositionBlueprint {
  id: string;
  artifactProfileRef?: string;
  deliveryContract?: BaseSetupCompositionDeliveryContract;
  steps?: BaseSetupCompositionStep[];
}

export interface BaseSetupCatalogProjection {
  id: string;
  targetCatalog: BaseSetupTargetCatalog;
  entryKey: string;
  title: string;
  summary: string;
  category: string;
  outputHint: string;
  bundleRefId: string;
  slotProfileRef: string;
  bindingProfileRef: string;
  artifactProfileRef: string;
  scorecardProfileRef: string;
  policyProfileRef: string;
  compositionBlueprintRef?: string;
  skillKey?: string;
  entryHint?: string;
  aliases?: string[];
  triggerHints?: string[];
  source?: ServiceSkillSource;
  skillType?: ServiceSkillType;
  readinessRequirements?: ServiceSkillReadinessRequirements;
  usageGuidelines?: string[];
  setupRequirements?: string[];
  examples?: string[];
  promptTemplateKey?: ServiceSkillPromptTemplateKey;
  themeTarget?: string;
  siteCapabilityBinding?: ServiceSkillSiteCapabilityBinding;
  sceneBinding?: ServiceSkillSceneBinding;
  version?: string;
}

export interface BaseSetupCompatibility {
  minAppVersion: string;
  requiredKernelCapabilities: string[];
  seededFallback?: boolean;
  compatCatalogProjection?: boolean;
}

export interface BaseSetupPackage {
  id: string;
  version: string;
  title: string;
  summary: string;
  bundleRefs: BaseSetupBundleRef[];
  catalogProjections: BaseSetupCatalogProjection[];
  slotProfiles: BaseSetupSlotProfile[];
  bindingProfiles: BaseSetupBindingProfile[];
  compositionBlueprints?: BaseSetupCompositionBlueprint[];
  artifactProfiles: BaseSetupArtifactProfile[];
  scorecardProfiles: BaseSetupScorecardProfile[];
  policyProfiles: BaseSetupPolicyProfile[];
  compatibility: BaseSetupCompatibility;
}

export type BaseSetupValidationLevel = "L0" | "L1" | "L2";
export type BaseSetupValidationSeverity = "error" | "warning";

export interface BaseSetupValidationIssue {
  level: BaseSetupValidationLevel;
  severity: BaseSetupValidationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface BaseSetupValidationResult {
  ok: boolean;
  issues: BaseSetupValidationIssue[];
}

export interface BaseSetupProjectionIndex {
  artifactProfileRefsByProjectionId: Record<string, string>;
  scorecardProfileRefsByProjectionId: Record<string, string>;
  policyProfileRefsByProjectionId: Record<string, string>;
  compositionBlueprintRefsByProjectionId: Record<string, string>;
}

export interface CompiledBaseSetupPackage {
  packageId: string;
  packageVersion: string;
  serviceSkillCatalogProjection: ServiceSkillCatalog;
  projectionIndex: BaseSetupProjectionIndex;
}

export type BaseSetupRolloutDecision =
  | "accept"
  | "fallback_seeded"
  | "reject_invalid_package"
  | "reject_upgrade_required";

export interface BaseSetupRolloutResult {
  decision: BaseSetupRolloutDecision;
  reason?: string;
}

export interface BaseSetupRolloutInput {
  appVersion: string;
  seededFallbackAvailable: boolean;
  supportedBindingFamilies?: readonly ServiceSkillExecutorBinding[];
  supportedViewerKinds?: readonly BaseSetupViewerKind[];
  supportedKernelCapabilities?: readonly string[];
  validationResult?: BaseSetupValidationResult;
}
