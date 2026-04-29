import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import {
  readStoredBaseSetupPackageSnapshot,
  type StoredBaseSetupPackageSnapshot,
} from "./storage";
import type {
  BaseSetupAutomationProfile,
  BaseSetupCatalogProjection,
} from "./types";

export interface BaseSetupProjectionRefs {
  packageId?: string;
  packageVersion?: string;
  projectionId?: string;
  artifactProfileRef?: string;
  scorecardProfileRef?: string;
  policyProfileRef?: string;
  automationProfileRef?: string;
  compositionBlueprintRef?: string;
}

export interface ResolvedBaseSetupAutomationProjection {
  refs: BaseSetupProjectionRefs;
  profile: BaseSetupAutomationProfile | null;
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function readSkillBundleMetadata(
  skill: Pick<ServiceSkillItem, "skillBundle">,
  key: string,
): string | undefined {
  return normalizeOptionalText(skill.skillBundle?.metadata?.[key]);
}

function resolveProjectionCandidates(
  skill: Pick<ServiceSkillItem, "id" | "skillBundle">,
): string[] {
  const candidates = [
    readSkillBundleMetadata(skill, "Lime_projection_id"),
    normalizeOptionalText(skill.id),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidates));
}

function findProjectionInSnapshot(
  snapshot: StoredBaseSetupPackageSnapshot | null,
  skill: Pick<ServiceSkillItem, "id" | "skillBundle">,
): BaseSetupCatalogProjection | null {
  if (!snapshot) {
    return null;
  }

  const candidates = resolveProjectionCandidates(skill);
  for (const projectionId of candidates) {
    const matchedProjection = snapshot.package.catalogProjections.find(
      (projection) => projection.id === projectionId,
    );
    if (matchedProjection) {
      return matchedProjection;
    }
  }

  return null;
}

export function resolveBaseSetupProjectionRefsForSkill(
  skill: Pick<ServiceSkillItem, "id" | "skillBundle">,
  snapshot: StoredBaseSetupPackageSnapshot | null = readStoredBaseSetupPackageSnapshot(),
): BaseSetupProjectionRefs {
  const projection = findProjectionInSnapshot(snapshot, skill);

  return {
    packageId:
      snapshot?.package.id ??
      readSkillBundleMetadata(skill, "Lime_base_setup_package_id"),
    packageVersion:
      snapshot?.package.version ??
      readSkillBundleMetadata(skill, "Lime_base_setup_package_version"),
    projectionId:
      projection?.id ?? readSkillBundleMetadata(skill, "Lime_projection_id"),
    artifactProfileRef:
      projection?.artifactProfileRef ??
      readSkillBundleMetadata(skill, "Lime_artifact_profile_ref"),
    scorecardProfileRef:
      projection?.scorecardProfileRef ??
      readSkillBundleMetadata(skill, "Lime_scorecard_profile_ref"),
    policyProfileRef:
      projection?.policyProfileRef ??
      readSkillBundleMetadata(skill, "Lime_policy_profile_ref"),
    automationProfileRef:
      projection?.automationProfileRef ??
      readSkillBundleMetadata(skill, "Lime_automation_profile_ref"),
    compositionBlueprintRef:
      projection?.compositionBlueprintRef ??
      readSkillBundleMetadata(skill, "Lime_composition_blueprint_ref"),
  };
}

export function resolveBaseSetupAutomationProjectionForSkill(
  skill: Pick<ServiceSkillItem, "id" | "skillBundle">,
  snapshot: StoredBaseSetupPackageSnapshot | null = readStoredBaseSetupPackageSnapshot(),
): ResolvedBaseSetupAutomationProjection {
  const refs = resolveBaseSetupProjectionRefsForSkill(skill, snapshot);
  const profile = refs.automationProfileRef
    ? (snapshot?.package.automationProfiles?.find(
        (item) => item.id === refs.automationProfileRef,
      ) ?? null)
    : null;

  return {
    refs,
    profile: profile ? cloneJsonValue(profile) : null,
  };
}
