import type {
  ExpertAvatar,
  ExpertCatalog,
  ExpertCategory,
  ExpertProfile,
  ExpertRanking,
  ExpertReadiness,
  ExpertRelease,
  ExpertShowcaseItem,
  ExpertStats,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAvatar(value: unknown): value is ExpertAvatar {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.kind === "emoji" ||
      value.kind === "url" ||
      value.kind === "asset") &&
    typeof value.value === "string" &&
    value.value.trim().length > 0
  );
}

function isStats(value: unknown): value is ExpertStats {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isFiniteNumber(value.usageCount) &&
    isFiniteNumber(value.likeCount) &&
    (value.hotScore === undefined || isFiniteNumber(value.hotScore)) &&
    (value.freshReleasedAt === undefined ||
      typeof value.freshReleasedAt === "string")
  );
}

function isReadiness(value: unknown): value is ExpertReadiness {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.requiresModel === undefined ||
      typeof value.requiresModel === "boolean") &&
    (value.requiresBrowser === undefined ||
      typeof value.requiresBrowser === "boolean") &&
    (value.requiresProject === undefined ||
      typeof value.requiresProject === "boolean") &&
    (value.missingSkillRefs === undefined ||
      isStringArray(value.missingSkillRefs))
  );
}

function isRelease(value: unknown): value is ExpertRelease {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.releaseId === "string" &&
    value.releaseId.trim().length > 0 &&
    typeof value.version === "string" &&
    value.version.trim().length > 0 &&
    typeof value.personaRef === "string" &&
    value.personaRef.trim().length > 0 &&
    (value.personaHash === undefined ||
      typeof value.personaHash === "string") &&
    (value.memoryTemplateRef === undefined ||
      typeof value.memoryTemplateRef === "string") &&
    isStringArray(value.skillRefs) &&
    isStringArray(value.workflowRefs) &&
    isReadiness(value.readiness) &&
    (value.releasedAt === undefined || typeof value.releasedAt === "string")
  );
}

function isShowcaseItem(value: unknown): value is ExpertShowcaseItem {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.title === "string" && typeof value.body === "string";
}

function isProfile(value: unknown): value is ExpertProfile {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.slug === "string" &&
    value.slug.trim().length > 0 &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    typeof value.summary === "string" &&
    isAvatar(value.avatar) &&
    typeof value.category === "string" &&
    value.category.trim().length > 0 &&
    isStringArray(value.tags) &&
    (value.source === "cloud_catalog" ||
      value.source === "builtin" ||
      value.source === "local_custom") &&
    isStats(value.stats) &&
    isRelease(value.release) &&
    isStringArray(value.promptStarters) &&
    Array.isArray(value.showcase) &&
    value.showcase.every(isShowcaseItem)
  );
}

function isRanking(value: unknown): value is ExpertRanking {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.key === "string" &&
    value.key.trim().length > 0 &&
    typeof value.title === "string" &&
    isStringArray(value.items) &&
    (value.summary === undefined || typeof value.summary === "string") &&
    (value.category === undefined || typeof value.category === "string") &&
    (value.generatedAt === undefined ||
      typeof value.generatedAt === "string") &&
    (value.expiresAt === undefined || typeof value.expiresAt === "string")
  );
}

function isCategory(value: unknown): value is ExpertCategory {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.key === "string" &&
    value.key.trim().length > 0 &&
    typeof value.title === "string" &&
    isFiniteNumber(value.sort)
  );
}

export function parseExpertCatalog(value: unknown): ExpertCatalog | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.version !== "string" ||
    typeof value.catalogId !== "string" ||
    typeof value.syncedAt !== "string" ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.rankings) ||
    !Array.isArray(value.categories)
  ) {
    return null;
  }
  if (
    !value.items.every(isProfile) ||
    !value.rankings.every(isRanking) ||
    !value.categories.every(isCategory)
  ) {
    return null;
  }

  return JSON.parse(JSON.stringify(value)) as ExpertCatalog;
}
