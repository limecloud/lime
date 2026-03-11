import type { Skill } from "@/lib/api/skills";

interface SkillSection {
  key: "builtin" | "local" | "remote";
  title: string;
  description: string;
  skills: Skill[];
}

export function filterSkillsByQueryAndStatus(
  skills: Skill[],
  searchQuery: string,
  filterStatus: "all" | "installed" | "uninstalled",
) {
  return skills.filter((skill) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      (skill.repoOwner?.toLowerCase().includes(q) ?? false) ||
      (skill.repoName?.toLowerCase().includes(q) ?? false);

    const matchesFilter =
      filterStatus === "all" ||
      (filterStatus === "installed" && skill.installed) ||
      (filterStatus === "uninstalled" && !skill.installed);

    return matchesSearch && matchesFilter;
  });
}

export function groupSkillsBySourceKind(skills: Skill[]): SkillSection[] {
  const builtinSkills: Skill[] = [];
  const localSkills: Skill[] = [];
  const remoteSkills: Skill[] = [];

  for (const skill of skills) {
    if (skill.sourceKind === "builtin") {
      builtinSkills.push(skill);
    } else if (skill.repoOwner && skill.repoName) {
      remoteSkills.push(skill);
    } else {
      localSkills.push(skill);
    }
  }

  return [
    {
      key: "builtin",
      title: "BUILT-IN SKILLS",
      description: "应用内置技能，随 ProxyCast 提供并默认可用。",
      skills: builtinSkills,
    },
    {
      key: "local",
      title: "LOCAL SKILLS",
      description: "本地已安装或手工放入的技能。",
      skills: localSkills,
    },
    {
      key: "remote",
      title: "REMOTE SKILLS",
      description: "远程技能仓库，可按需安装。",
      skills: remoteSkills,
    },
  ];
}
