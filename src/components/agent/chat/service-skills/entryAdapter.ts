import type { ServiceSkillHomeItem, ServiceSkillItem } from "./types";

export type ServiceSkillEntrySurface = "home" | "mention" | "workspace";

const DEFAULT_SERVICE_SKILL_ENTRY_SURFACES: ServiceSkillEntrySurface[] = [
  "home",
  "mention",
  "workspace",
];

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function collectServiceSkillSearchTokens(skill: ServiceSkillItem): string[] {
  return [
    skill.title,
    skill.skillKey ?? "",
    skill.category,
    skill.summary,
    skill.entryHint ?? "",
    ...(skill.aliases ?? []),
  ]
    .map(normalizeSearchText)
    .filter(Boolean);
}

export function supportsServiceSkillEntrySurface(
  skill: ServiceSkillItem,
  surface: ServiceSkillEntrySurface,
): boolean {
  const surfaces = skill.surfaceScopes?.length
    ? skill.surfaceScopes
    : DEFAULT_SERVICE_SKILL_ENTRY_SURFACES;
  return surfaces.includes(surface);
}

export function resolveServiceSkillEntryDescription(
  skill: Pick<ServiceSkillItem, "entryHint" | "summary">,
): string {
  return skill.entryHint?.trim() || skill.summary;
}

export function filterMentionableServiceSkills(
  skills: ServiceSkillHomeItem[],
  query: string,
): ServiceSkillHomeItem[] {
  const normalizedQuery = normalizeSearchText(query);

  return skills.filter((skill) => {
    if (!supportsServiceSkillEntrySurface(skill, "mention")) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return collectServiceSkillSearchTokens(skill).some((token) =>
      token.includes(normalizedQuery),
    );
  });
}
