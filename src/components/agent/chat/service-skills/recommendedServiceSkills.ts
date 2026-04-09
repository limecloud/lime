import {
  supportsServiceSkillEntrySurface,
  type ServiceSkillEntrySurface,
} from "./entryAdapter";
import type { ServiceSkillHomeItem } from "./types";

export interface ServiceSkillRecommendationBuckets {
  recentSkills: ServiceSkillHomeItem[];
  featuredSkills: ServiceSkillHomeItem[];
  remainingSkills: ServiceSkillHomeItem[];
}

interface BuildServiceSkillRecommendationBucketsOptions {
  featuredLimit?: number;
  surface?: ServiceSkillEntrySurface;
}

interface ListPrimaryRecommendedServiceSkillsOptions {
  limit: number;
  maxRecent?: number;
  featuredLimit?: number;
  surface?: ServiceSkillEntrySurface;
}

function compareRecentServiceSkills(
  left: ServiceSkillHomeItem,
  right: ServiceSkillHomeItem,
): number {
  const leftUsedAt = left.recentUsedAt ?? 0;
  const rightUsedAt = right.recentUsedAt ?? 0;
  if (leftUsedAt !== rightUsedAt) {
    return rightUsedAt - leftUsedAt;
  }
  return left.title.localeCompare(right.title, "zh-CN");
}

function isRecentServiceSkill(skill: ServiceSkillHomeItem): boolean {
  return skill.isRecent && typeof skill.recentUsedAt === "number";
}

function filterServiceSkillsBySurface(
  skills: ServiceSkillHomeItem[],
  surface?: ServiceSkillEntrySurface,
): ServiceSkillHomeItem[] {
  if (!surface) {
    return skills;
  }

  return skills.filter((skill) =>
    supportsServiceSkillEntrySurface(skill, surface),
  );
}

export function buildServiceSkillRecommendationBuckets(
  skills: ServiceSkillHomeItem[],
  options: BuildServiceSkillRecommendationBucketsOptions = {},
): ServiceSkillRecommendationBuckets {
  const scopedSkills = filterServiceSkillsBySurface(skills, options.surface);
  const recentSkills = scopedSkills
    .filter(isRecentServiceSkill)
    .sort(compareRecentServiceSkills);
  const recentSkillIds = new Set(recentSkills.map((skill) => skill.id));
  const remainingCandidates = scopedSkills.filter(
    (skill) => !recentSkillIds.has(skill.id),
  );
  const featuredLimit = Math.max(
    options.featuredLimit ?? remainingCandidates.length,
    0,
  );
  const featuredSkills = remainingCandidates.slice(0, featuredLimit);
  const featuredSkillIds = new Set(featuredSkills.map((skill) => skill.id));
  const remainingSkills = remainingCandidates.filter(
    (skill) => !featuredSkillIds.has(skill.id),
  );

  return {
    recentSkills,
    featuredSkills,
    remainingSkills,
  };
}

export function listPrimaryRecommendedServiceSkills(
  skills: ServiceSkillHomeItem[],
  options: ListPrimaryRecommendedServiceSkillsOptions,
): ServiceSkillHomeItem[] {
  const limit = Math.max(options.limit, 0);
  if (limit === 0) {
    return [];
  }

  const { recentSkills, featuredSkills } =
    buildServiceSkillRecommendationBuckets(skills, {
      featuredLimit: Math.max(options.featuredLimit ?? limit, 0),
      surface: options.surface,
    });
  const limitedRecentSkills = recentSkills.slice(
    0,
    Math.max(options.maxRecent ?? limit, 0),
  );
  const remainingSlots = Math.max(limit - limitedRecentSkills.length, 0);

  return [
    ...limitedRecentSkills,
    ...featuredSkills.slice(0, remainingSlots),
  ];
}
