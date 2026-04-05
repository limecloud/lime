import type { Skill } from "@/lib/api/skills";

export const SKILL_SELECTION_DISPLAY_COPY = {
  titleLabel: "技能能力",
  emptySelectionLabel: "按需挂载任务能力",
  clearActionLabel: "清空技能",
  loadingLabel: "技能加载中...",
} as const;

export function getActiveSkillDisplayLabel(
  activeSkill?: Skill | null,
): string | null {
  if (!activeSkill) {
    return null;
  }

  return `已挂载 ${activeSkill.name}`;
}

export function getSkillSelectionSummaryLabel({
  activeSkill,
  skillCount,
}: {
  activeSkill?: Skill | null;
  skillCount: number;
}): string {
  const activeSkillLabel = getActiveSkillDisplayLabel(activeSkill);

  if (activeSkillLabel) {
    return activeSkillLabel;
  }

  if (skillCount > 0) {
    return `${skillCount} 项技能可挂载`;
  }

  return SKILL_SELECTION_DISPLAY_COPY.emptySelectionLabel;
}
