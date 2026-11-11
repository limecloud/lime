import { resolveServiceSkillEntryDescription } from "@/components/agent/chat/service-skills/entryAdapter";
import {
  buildServiceSkillCapabilityDescription,
  type ServiceSkillPresentationCopy,
} from "@/components/agent/chat/service-skills/skillPresentation";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
import type { Skill } from "@/lib/api/skills";
import type {
  SkillMarketplaceItem,
  SkillMarketplaceVisualAsset,
} from "@/lib/api/officialSkillMarketplace";
import {
  buildInstalledSkillCapabilityDescription,
  type InstalledSkillPresentationCopy,
} from "./installedSkillPresentation";

export type SkillsWorkspaceView = "store" | "builtin" | "installed";

export type SkillStoreItem =
  | {
      source: "official";
      skill: SkillMarketplaceItem;
      serviceSkill?: never;
    }
  | {
      source: "local_fallback";
      skill: SkillMarketplaceItem;
      serviceSkill: ServiceSkillHomeItem;
    };

export function normalizeSkillsKeyword(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesSkillsText(
  query: string,
  ...values: Array<string | undefined>
): boolean {
  const normalizedQuery = normalizeSkillsKeyword(query);
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMarketplaceCoverPlaceholder(
  title: string,
  category?: string,
): SkillMarketplaceVisualAsset {
  const safeTitle = escapeSvgText(title || "Lime Skill");
  const safeCategory = escapeSvgText(category || "Official");
  return {
    kind: "svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" role="img" aria-label="${safeTitle}"><rect width="320" height="180" rx="22" fill="#f7f7f5"/><rect x="1" y="1" width="318" height="178" rx="21" fill="none" stroke="#deded8"/><circle cx="264" cy="48" r="28" fill="#ededeb"/><path d="M48 70h118M48 92h186M48 114h142" stroke="#8d8d86" stroke-width="8" stroke-linecap="round"/><text x="48" y="145" font-family="ui-sans-serif,system-ui" font-size="18" font-weight="700" fill="#262626">${safeTitle}</text><text x="48" y="165" font-family="ui-sans-serif,system-ui" font-size="12" fill="#8c8c8c">${safeCategory}</text></svg>`,
  };
}

export function buildMarketplaceIconPlaceholder(
  title: string,
): SkillMarketplaceVisualAsset {
  const safeTitle = escapeSvgText(title || "Lime");
  const initial = escapeSvgText([...safeTitle][0] || "L");
  return {
    kind: "svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="${safeTitle}"><rect width="96" height="96" rx="20" fill="#f5f5f5"/><rect x="1" y="1" width="94" height="94" rx="19" fill="none" stroke="#d9d9d9"/><path d="M28 36h40M28 48h32M28 60h24" stroke="#8c8c8c" stroke-width="5" stroke-linecap="round"/><text x="48" y="82" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="18" font-weight="700" fill="#595959">${initial}</text></svg>`,
  };
}

export function buildFallbackMarketplaceItem(
  skill: ServiceSkillHomeItem,
): SkillMarketplaceItem {
  return {
    id: `local-fallback:${skill.id}`,
    name: skill.skillKey || skill.id,
    aliases: skill.aliases ?? [],
    title: skill.title,
    summary: skill.summary || resolveServiceSkillEntryDescription(skill),
    category: skill.category,
    outputHint: skill.outputHint,
    version: skill.version,
    sort: 0,
    icon: buildMarketplaceIconPlaceholder(skill.title),
    cover: buildMarketplaceCoverPlaceholder(skill.title, skill.category),
    bundle: skill.skillBundle
      ? {
          ...skill.skillBundle,
          resourceSummary: skill.skillBundle.resourceSummary,
          standardCompliance: skill.skillBundle.standardCompliance,
        }
      : undefined,
  };
}

export function buildInstalledLocalSkills(
  localSkills: Skill[],
  optimisticInstalledSkill: Skill | null,
): Skill[] {
  const installedSkills = localSkills.filter((skill) => skill.installed);

  if (!optimisticInstalledSkill) {
    return installedSkills;
  }

  return [
    optimisticInstalledSkill,
    ...installedSkills.filter(
      (skill) => skill.directory !== optimisticInstalledSkill.directory,
    ),
  ];
}

export function isMarketplaceSkillInstalledAsLocalSkill({
  marketplaceSkill,
  localSkill,
}: {
  marketplaceSkill: SkillMarketplaceItem;
  localSkill: Skill;
}): boolean {
  const candidates = new Set(
    [
      marketplaceSkill.name,
      `${marketplaceSkill.name}-official`,
      ...(marketplaceSkill.aliases ?? []),
      ...(marketplaceSkill.aliases ?? []).map((alias) => `${alias}-official`),
    ]
      .map((value) => value.trim())
      .filter(Boolean),
  );

  return (
    candidates.has(localSkill.directory) ||
    candidates.has(localSkill.name) ||
    localSkill.metadata?.lime_marketplace_skill_name === marketplaceSkill.name
  );
}

export function getVisibleInstalledLocalSkills({
  installedLocalSkills,
  searchQuery,
  highlightedInstalledSkillDirectory,
  copy,
}: {
  installedLocalSkills: Skill[];
  searchQuery: string;
  highlightedInstalledSkillDirectory?: string | null;
  copy: InstalledSkillPresentationCopy;
}): Skill[] {
  const filteredSkills = installedLocalSkills.filter((skill) =>
    matchesSkillsText(
      searchQuery,
      skill.name,
      skill.description,
      skill.key,
      skill.repoOwner,
      skill.repoName,
      buildInstalledSkillCapabilityDescription(skill, { copy }),
    ),
  );

  if (!highlightedInstalledSkillDirectory) {
    return filteredSkills;
  }

  return [...filteredSkills].sort((left, right) => {
    const leftHighlighted =
      left.directory === highlightedInstalledSkillDirectory ? 1 : 0;
    const rightHighlighted =
      right.directory === highlightedInstalledSkillDirectory ? 1 : 0;

    if (leftHighlighted !== rightHighlighted) {
      return rightHighlighted - leftHighlighted;
    }

    return left.name.localeCompare(right.name, "zh-CN");
  });
}

export function buildSkillStoreItems({
  officialMarketplaceSkills,
  workspaceServiceSkills,
  fallbackLimit = 12,
}: {
  officialMarketplaceSkills: SkillMarketplaceItem[];
  workspaceServiceSkills: ServiceSkillHomeItem[];
  fallbackLimit?: number;
}): SkillStoreItem[] {
  if (officialMarketplaceSkills.length > 0) {
    return officialMarketplaceSkills.map((skill) => ({
      source: "official",
      skill,
    }));
  }

  return workspaceServiceSkills.slice(0, fallbackLimit).map((serviceSkill) => ({
    source: "local_fallback",
    skill: buildFallbackMarketplaceItem(serviceSkill),
    serviceSkill,
  }));
}

export function getVisibleSkillStoreItems({
  skillStoreItems,
  searchQuery,
  serviceSkillPresentationCopy,
}: {
  skillStoreItems: SkillStoreItem[];
  searchQuery: string;
  serviceSkillPresentationCopy: ServiceSkillPresentationCopy;
}): SkillStoreItem[] {
  return skillStoreItems.filter(({ skill, serviceSkill }) =>
    matchesSkillsText(
      searchQuery,
      skill.title,
      skill.summary,
      skill.category,
      skill.outputHint,
      skill.bundle?.description,
      ...(skill.aliases ?? []),
      serviceSkill
        ? buildServiceSkillCapabilityDescription(serviceSkill, {
            copy: serviceSkillPresentationCopy,
          })
        : undefined,
    ),
  );
}

export function getVisibleBuiltinLocalSkills({
  localSkills,
  searchQuery,
}: {
  localSkills: Skill[];
  searchQuery: string;
}): Skill[] {
  return localSkills
    .filter((skill) => skill.sourceKind === "builtin")
    .filter((skill) =>
      matchesSkillsText(searchQuery, skill.name, skill.description, skill.key),
    );
}

export function getVisibleUserInstalledSkills(
  visibleInstalledLocalSkills: Skill[],
): Skill[] {
  return visibleInstalledLocalSkills.filter(
    (skill) =>
      skill.sourceKind !== "builtin" &&
      skill.catalogSource !== "project" &&
      skill.catalogSource !== "remote" &&
      !(skill.catalogSource === undefined && skill.repoOwner && skill.repoName),
  );
}
