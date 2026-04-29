import {
  readStoredBaseSetupPackageSnapshot,
  type StoredBaseSetupPackageSnapshot,
} from "@/lib/base-setup/storage";
import type {
  BaseSetupAllowedBindingFamily,
  BaseSetupArtifactProfile,
  BaseSetupBindingProfile,
  BaseSetupCatalogProjection,
  BaseSetupCompositionBlueprint,
  BaseSetupPackage,
  BaseSetupScorecardProfile,
} from "@/lib/base-setup/types";
import type {
  SceneAppCatalog,
  SceneAppCompositionProfile,
  SceneAppCompositionStepDescriptor,
  SceneAppDescriptor,
  SceneAppEntryBinding,
  SceneAppLaunchRequirement,
  SceneAppDeliveryContract,
  SceneAppDeliveryProfile,
  SceneAppPattern,
  SceneAppScorecardProfile,
  SceneAppType,
} from "./types";

interface SceneProjectionGroup {
  serviceSkillProjection?: BaseSetupCatalogProjection;
  sceneProjection?: BaseSetupCatalogProjection;
}

function normalizeCompatSceneAppBindingFamily(
  bindingFamily: BaseSetupAllowedBindingFamily,
): SceneAppEntryBinding["bindingFamily"] {
  return bindingFamily === "cloud_scene" ? "agent_turn" : bindingFamily;
}

function normalizeCompatSceneAppCapabilityRef(capabilityRef: string): string {
  return capabilityRef === "cloud_scene" ? "agent_turn" : capabilityRef;
}

function normalizeString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

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

function buildProjectionGroups(
  pkg: BaseSetupPackage,
): Map<string, SceneProjectionGroup> {
  const groups = new Map<string, SceneProjectionGroup>();

  for (const projection of pkg.catalogProjections) {
    if (
      projection.targetCatalog !== "service_skill_catalog" &&
      projection.targetCatalog !== "scene_catalog"
    ) {
      continue;
    }

    const groupKey = normalizeString(projection.entryKey) ?? projection.id;
    const current = groups.get(groupKey) ?? {};

    if (projection.targetCatalog === "service_skill_catalog") {
      current.serviceSkillProjection = projection;
    } else {
      current.sceneProjection = projection;
    }

    groups.set(groupKey, current);
  }

  return groups;
}

function buildBindingProfileMap(
  pkg: BaseSetupPackage,
): Map<string, BaseSetupBindingProfile> {
  return new Map(pkg.bindingProfiles.map((profile) => [profile.id, profile]));
}

function buildArtifactProfileMap(
  pkg: BaseSetupPackage,
): Map<string, BaseSetupArtifactProfile> {
  return new Map(pkg.artifactProfiles.map((profile) => [profile.id, profile]));
}

function buildCompositionBlueprintMap(
  pkg: BaseSetupPackage,
): Map<string, BaseSetupCompositionBlueprint> {
  return new Map(
    (pkg.compositionBlueprints ?? []).map((blueprint) => [
      blueprint.id,
      blueprint,
    ]),
  );
}

function buildScorecardProfileMap(
  pkg: BaseSetupPackage,
): Map<string, BaseSetupScorecardProfile> {
  return new Map(pkg.scorecardProfiles.map((profile) => [profile.id, profile]));
}

function resolveDistinctBindingFamilies(
  blueprint: BaseSetupCompositionBlueprint | undefined,
  bindingProfileMap: Map<string, BaseSetupBindingProfile>,
): Array<SceneAppEntryBinding["bindingFamily"]> {
  if (!blueprint?.steps?.length) {
    return [];
  }

  const families = blueprint.steps
    .map((step) => step.bindingProfileRef)
    .filter((value): value is string => Boolean(value))
    .map((ref) => bindingProfileMap.get(ref)?.bindingFamily)
    .filter((value): value is BaseSetupAllowedBindingFamily => Boolean(value))
    .map((bindingFamily) =>
      normalizeCompatSceneAppBindingFamily(bindingFamily),
    );

  return Array.from(new Set(families));
}

function inferSceneAppType(
  binding: BaseSetupBindingProfile,
  blueprint: BaseSetupCompositionBlueprint | undefined,
  bindingProfileMap: Map<string, BaseSetupBindingProfile>,
): SceneAppType {
  const blueprintFamilies = resolveDistinctBindingFamilies(
    blueprint,
    bindingProfileMap,
  );
  if (blueprintFamilies.length > 1) {
    return "hybrid";
  }

  switch (normalizeCompatSceneAppBindingFamily(binding.bindingFamily)) {
    case "browser_assist":
      return "browser_grounded";
    case "automation_job":
      return "local_durable";
    case "native_skill":
    case "agent_turn":
    default:
      return "local_instant";
  }
}

function inferPatternPrimary(
  binding: BaseSetupBindingProfile,
  artifact: BaseSetupArtifactProfile,
  blueprint: BaseSetupCompositionBlueprint | undefined,
  requiredSlotCount: number,
): SceneAppPattern {
  if ((blueprint?.steps?.length ?? 0) > 1) {
    return "pipeline";
  }
  if (binding.bindingFamily === "browser_assist") {
    return "tool_wrapper";
  }
  if (requiredSlotCount > 1) {
    return "inversion";
  }
  if (
    artifact.viewerKind === "document" ||
    artifact.deliveryContract === "table_report" ||
    artifact.deliveryContract === "project_pack"
  ) {
    return "generator";
  }
  return "pipeline";
}

function inferPatternStack(params: {
  primary: SceneAppPattern;
  binding: BaseSetupBindingProfile;
  artifact: BaseSetupArtifactProfile;
  blueprint: BaseSetupCompositionBlueprint | undefined;
  requiredSlotCount: number;
}): SceneAppPattern[] {
  const patterns = new Set<SceneAppPattern>([params.primary]);

  if ((params.blueprint?.steps?.length ?? 0) > 1) {
    patterns.add("pipeline");
  }
  if (params.requiredSlotCount > 0) {
    patterns.add("inversion");
  }
  if (params.binding.bindingFamily === "browser_assist") {
    patterns.add("tool_wrapper");
  }
  if (
    params.artifact.viewerKind === "document" ||
    params.artifact.deliveryContract === "artifact_bundle" ||
    params.artifact.deliveryContract === "project_pack" ||
    params.artifact.deliveryContract === "table_report"
  ) {
    patterns.add("generator");
  }

  return Array.from(patterns);
}

function inferInfraProfile(
  binding: BaseSetupBindingProfile,
  artifact: BaseSetupArtifactProfile,
  blueprint: BaseSetupCompositionBlueprint | undefined,
): string[] {
  const bindingFamily = normalizeCompatSceneAppBindingFamily(
    binding.bindingFamily,
  );
  const infra = new Set<string>(
    (binding.capabilityRefs ?? []).map((capabilityRef) =>
      normalizeCompatSceneAppCapabilityRef(capabilityRef),
    ),
  );
  infra.add(bindingFamily);

  if (bindingFamily === "browser_assist") {
    infra.add("browser_connector");
  }
  if (
    bindingFamily === "automation_job" ||
    binding.runnerType === "scheduled"
  ) {
    infra.add("automation_schedule");
  }
  if (
    artifact.deliveryContract === "artifact_bundle" ||
    artifact.deliveryContract === "project_pack" ||
    artifact.outputDestination
  ) {
    infra.add("workspace_storage");
  }
  if (artifact.deliveryContract === "artifact_bundle") {
    infra.add("artifact_bundle");
  }
  if (artifact.deliveryContract === "project_pack") {
    infra.add("project_pack");
  }
  if (artifact.viewerKind === "document") {
    infra.add("document_viewer");
  }
  if (artifact.viewerKind === "table_report") {
    infra.add("table_report_viewer");
  }
  if (blueprint?.id) {
    infra.add("composition_blueprint");
  }

  return Array.from(infra);
}

function buildLaunchRequirements(
  binding: BaseSetupBindingProfile,
  projection: BaseSetupCatalogProjection,
  requiredSlotCount: number,
): SceneAppLaunchRequirement[] {
  const requirements: SceneAppLaunchRequirement[] = [];

  if (requiredSlotCount > 0) {
    requirements.push({
      kind: "user_input",
      message: "需要先补齐场景输入或必填槽位。",
    });
  }
  if (projection.readinessRequirements?.requiresProject) {
    requirements.push({
      kind: "project",
      message: "该场景需要先绑定项目或工作区资产目录。",
    });
  }
  if (
    projection.readinessRequirements?.requiresBrowser ||
    normalizeCompatSceneAppBindingFamily(binding.bindingFamily) ===
      "browser_assist"
  ) {
    requirements.push({
      kind: "browser_session",
      message: "该场景需要可用的浏览器上下文或已附着会话。",
    });
  }
  if (
    normalizeCompatSceneAppBindingFamily(binding.bindingFamily) ===
      "automation_job" ||
    binding.runnerType === "scheduled"
  ) {
    requirements.push({
      kind: "automation",
      message: "该场景需要自动化调度能力。",
    });
  }

  return requirements;
}

function buildEntryBindings(params: {
  bindingFamily: BaseSetupAllowedBindingFamily;
  serviceSkillProjection?: BaseSetupCatalogProjection;
  sceneProjection?: BaseSetupCatalogProjection;
}): SceneAppEntryBinding[] {
  const bindings: SceneAppEntryBinding[] = [];
  const bindingFamily = normalizeCompatSceneAppBindingFamily(
    params.bindingFamily,
  );

  if (params.serviceSkillProjection) {
    bindings.push({
      kind: "service_skill",
      bindingFamily,
      serviceSkillId: params.serviceSkillProjection.id,
      skillKey: params.serviceSkillProjection.skillKey,
      aliases: params.serviceSkillProjection.aliases,
    });
  }

  const sceneBinding =
    params.sceneProjection?.sceneBinding ??
    params.serviceSkillProjection?.sceneBinding;
  if (sceneBinding) {
    bindings.push({
      kind: "scene",
      bindingFamily,
      sceneKey: sceneBinding.sceneKey,
      commandPrefix: sceneBinding.commandPrefix,
      aliases: sceneBinding.aliases,
      skillKey:
        params.sceneProjection?.skillKey ??
        params.serviceSkillProjection?.skillKey,
    });
  }

  return bindings;
}

function buildDeliveryProfile(params: {
  artifactProfile: BaseSetupArtifactProfile;
  compositionBlueprint?: BaseSetupCompositionBlueprint;
}): SceneAppDeliveryProfile {
  const requiredParts = dedupeStrings([
    ...(params.compositionBlueprint?.deliveryContract?.requiredParts ?? []),
    ...params.artifactProfile.requiredParts,
  ]);

  return {
    artifactProfileRef: params.artifactProfile.id,
    viewerKind: params.artifactProfile.viewerKind,
    requiredParts,
    primaryPart: requiredParts[0],
  };
}

function buildCompositionProfile(
  blueprint: BaseSetupCompositionBlueprint | undefined,
  bindingProfileMap: Map<string, BaseSetupBindingProfile>,
): SceneAppCompositionProfile | undefined {
  if (!blueprint?.id && !blueprint?.steps?.length) {
    return undefined;
  }

  const steps: SceneAppCompositionStepDescriptor[] = (
    blueprint?.steps ?? []
  ).map((step, index) => ({
    id: step.id,
    order: index + 1,
    bindingProfileRef: step.bindingProfileRef,
    bindingFamily: step.bindingProfileRef
      ? (() => {
          const bindingFamily = bindingProfileMap.get(
            step.bindingProfileRef,
          )?.bindingFamily;
          return bindingFamily
            ? normalizeCompatSceneAppBindingFamily(bindingFamily)
            : undefined;
        })()
      : undefined,
  }));

  return {
    blueprintRef: blueprint?.id,
    stepCount: steps.length,
    steps,
  };
}

function buildScorecardProfile(
  profileRef: string | undefined,
  scorecardProfile: BaseSetupScorecardProfile | undefined,
): SceneAppScorecardProfile | undefined {
  if (!profileRef && !scorecardProfile) {
    return undefined;
  }

  return {
    profileRef: profileRef ?? scorecardProfile?.id,
    metricKeys: scorecardProfile?.metrics ?? [],
    failureSignals: scorecardProfile?.failureSignals ?? [],
  };
}

function compileSceneAppDescriptor(params: {
  pkg: BaseSetupPackage;
  serviceSkillProjection?: BaseSetupCatalogProjection;
  sceneProjection?: BaseSetupCatalogProjection;
  bindingProfileMap: Map<string, BaseSetupBindingProfile>;
  artifactProfileMap: Map<string, BaseSetupArtifactProfile>;
  compositionBlueprintMap: Map<string, BaseSetupCompositionBlueprint>;
  scorecardProfileMap: Map<string, BaseSetupScorecardProfile>;
}): SceneAppDescriptor | null {
  const primaryProjection =
    params.sceneProjection ?? params.serviceSkillProjection ?? null;
  if (!primaryProjection) {
    return null;
  }

  const bindingProfile = params.bindingProfileMap.get(
    primaryProjection.bindingProfileRef,
  );
  const artifactProfile = params.artifactProfileMap.get(
    primaryProjection.artifactProfileRef,
  );
  if (!bindingProfile || !artifactProfile) {
    return null;
  }

  const slotProfile = params.pkg.slotProfiles.find(
    (profile) => profile.id === primaryProjection.slotProfileRef,
  );
  const requiredSlotCount =
    slotProfile?.slots.filter((slot) => slot.required).length ?? 0;
  const compositionBlueprint = primaryProjection.compositionBlueprintRef
    ? params.compositionBlueprintMap.get(
        primaryProjection.compositionBlueprintRef,
      )
    : undefined;
  const scorecardProfile = params.scorecardProfileMap.get(
    primaryProjection.scorecardProfileRef,
  );

  const sceneappType = inferSceneAppType(
    bindingProfile,
    compositionBlueprint,
    params.bindingProfileMap,
  );
  const patternPrimary = inferPatternPrimary(
    bindingProfile,
    artifactProfile,
    compositionBlueprint,
    requiredSlotCount,
  );
  const deliveryProfile = buildDeliveryProfile({
    artifactProfile,
    compositionBlueprint,
  });
  const compositionProfile = buildCompositionProfile(
    compositionBlueprint,
    params.bindingProfileMap,
  );
  const compiledScorecardProfile = buildScorecardProfile(
    primaryProjection.scorecardProfileRef,
    scorecardProfile,
  );

  return {
    id:
      normalizeString(primaryProjection.skillKey) ??
      normalizeString(primaryProjection.sceneBinding?.sceneKey) ??
      primaryProjection.entryKey,
    title: params.sceneProjection?.title ?? primaryProjection.title,
    summary: params.sceneProjection?.summary ?? primaryProjection.summary,
    category: primaryProjection.category,
    sceneappType,
    patternPrimary,
    patternStack: inferPatternStack({
      primary: patternPrimary,
      binding: bindingProfile,
      artifact: artifactProfile,
      blueprint: compositionBlueprint,
      requiredSlotCount,
    }),
    capabilityRefs: (bindingProfile.capabilityRefs ?? []).map((capabilityRef) =>
      normalizeCompatSceneAppCapabilityRef(capabilityRef),
    ),
    infraProfile: inferInfraProfile(
      bindingProfile,
      artifactProfile,
      compositionBlueprint,
    ),
    deliveryContract:
      artifactProfile.deliveryContract as SceneAppDeliveryContract,
    artifactKind: artifactProfile.defaultArtifactKind,
    outputHint: primaryProjection.outputHint,
    entryBindings: buildEntryBindings({
      bindingFamily: bindingProfile.bindingFamily,
      serviceSkillProjection: params.serviceSkillProjection,
      sceneProjection: params.sceneProjection,
    }),
    launchRequirements: buildLaunchRequirements(
      bindingProfile,
      primaryProjection,
      requiredSlotCount,
    ),
    linkedServiceSkillId: params.serviceSkillProjection?.id,
    linkedSceneKey:
      params.sceneProjection?.sceneBinding?.sceneKey ??
      params.serviceSkillProjection?.sceneBinding?.sceneKey,
    deliveryProfile,
    compositionProfile,
    scorecardProfile: compiledScorecardProfile,
    aliases: dedupeStrings([
      ...(primaryProjection.aliases ?? []),
      ...(params.serviceSkillProjection?.aliases ?? []),
      ...(params.sceneProjection?.aliases ?? []),
      ...(params.serviceSkillProjection?.sceneBinding?.aliases ?? []),
      ...(params.sceneProjection?.sceneBinding?.aliases ?? []),
    ]),
    sourcePackageId: params.pkg.id,
    sourcePackageVersion: params.pkg.version,
  };
}

export function compileSceneAppCatalogFromPackage(
  pkg: BaseSetupPackage,
  options: { generatedAt?: string } = {},
): SceneAppCatalog {
  const bindingProfileMap = buildBindingProfileMap(pkg);
  const artifactProfileMap = buildArtifactProfileMap(pkg);
  const compositionBlueprintMap = buildCompositionBlueprintMap(pkg);
  const scorecardProfileMap = buildScorecardProfileMap(pkg);
  const items = Array.from(buildProjectionGroups(pkg).values())
    .map((group) =>
      compileSceneAppDescriptor({
        pkg,
        serviceSkillProjection: group.serviceSkillProjection,
        sceneProjection: group.sceneProjection,
        bindingProfileMap,
        artifactProfileMap,
        compositionBlueprintMap,
        scorecardProfileMap,
      }),
    )
    .filter((item): item is SceneAppDescriptor => Boolean(item))
    .sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));

  return {
    version: pkg.version,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    items,
  };
}

export function compileSceneAppCatalogFromSnapshot(
  snapshot: StoredBaseSetupPackageSnapshot,
): SceneAppCatalog {
  return compileSceneAppCatalogFromPackage(snapshot.package, {
    generatedAt: snapshot.syncedAt,
  });
}

export function readStoredSceneAppCatalog(): SceneAppCatalog | null {
  const snapshot = readStoredBaseSetupPackageSnapshot();
  if (!snapshot) {
    return null;
  }

  return compileSceneAppCatalogFromSnapshot(snapshot);
}
