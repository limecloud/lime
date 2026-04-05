import type { Skill } from "@/lib/api/skills";

function normalizeSkillQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function matchesMentionableSkillQuery(
  skill: Skill,
  query: string,
): boolean {
  const normalizedQuery = normalizeSkillQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  return (
    skill.name.toLowerCase().includes(normalizedQuery) ||
    skill.key.toLowerCase().includes(normalizedQuery) ||
    skill.description?.toLowerCase().includes(normalizedQuery) === true
  );
}

export function partitionMentionableSkills(
  skills: Skill[],
  query: string,
): {
  installedSkills: Skill[];
  availableSkills: Skill[];
} {
  const installedSkills: Skill[] = [];
  const availableSkills: Skill[] = [];

  for (const skill of skills) {
    if (!matchesMentionableSkillQuery(skill, query)) {
      continue;
    }

    if (skill.installed) {
      installedSkills.push(skill);
      continue;
    }

    availableSkills.push(skill);
  }

  return {
    installedSkills,
    availableSkills,
  };
}
