import { useState, useCallback } from "react";
import type { Skill } from "@/lib/api/skills";
import {
  createSkillSelectionProps,
  type SkillSelectionProps,
  type SkillSelectionSourceProps,
} from "./skillSelectionBindings";

export function useActiveSkill() {
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);

  const wrapTextWithSkill = useCallback(
    (text: string) => {
      if (!activeSkill) return text;
      return `/${activeSkill.key} ${text}`.trim();
    },
    [activeSkill],
  );

  const clearActiveSkill = useCallback(() => setActiveSkill(null), []);
  const buildSkillSelection = useCallback(
    (source: SkillSelectionSourceProps): SkillSelectionProps =>
      createSkillSelectionProps({
        ...source,
        activeSkill,
        onSelectSkill: setActiveSkill,
        onClearSkill: clearActiveSkill,
      }),
    [activeSkill, clearActiveSkill],
  );

  return {
    activeSkill,
    setActiveSkill,
    wrapTextWithSkill,
    clearActiveSkill,
    buildSkillSelection,
  };
}
