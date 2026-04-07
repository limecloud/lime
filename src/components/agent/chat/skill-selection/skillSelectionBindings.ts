import type { Skill } from "@/lib/api/skills";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";

export interface SkillSelectionSourceProps {
  skills?: Skill[];
  serviceSkills?: ServiceSkillHomeItem[];
  isSkillsLoading?: boolean;
  onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
  onNavigateToSettings?: () => void;
  onImportSkill?: () => void | Promise<void>;
  onRefreshSkills?: () => void | Promise<void>;
}

export interface SkillSelectionControllerProps {
  activeSkill?: Skill | null;
  onSelectSkill: (skill: Skill) => void;
  onClearSkill?: () => void;
}

export interface SkillSelectionProps
  extends SkillSelectionSourceProps, SkillSelectionControllerProps {
  skills: Skill[];
  serviceSkills: ServiceSkillHomeItem[];
  activeSkill: Skill | null;
  isSkillsLoading: boolean;
}

export function createSkillSelectionProps({
  skills = [],
  serviceSkills = [],
  activeSkill = null,
  isSkillsLoading = false,
  ...rest
}: SkillSelectionSourceProps &
  SkillSelectionControllerProps): SkillSelectionProps {
  return {
    ...rest,
    skills,
    serviceSkills,
    activeSkill,
    isSkillsLoading,
  };
}

export function buildSkillSelectionBindings({
  skills,
  serviceSkills = [],
  activeSkill = null,
  isSkillsLoading = false,
  onSelectSkill,
  onSelectServiceSkill,
  onClearSkill,
  onNavigateToSettings,
  onImportSkill,
  onRefreshSkills,
}: SkillSelectionProps) {
  return {
    mentionProps: {
      skills,
      serviceSkills,
      onSelectSkill,
      onSelectServiceSkill,
      onNavigateToSettings,
    },
    selectorProps: {
      skills,
      serviceSkills,
      activeSkill,
      isLoading: isSkillsLoading,
      onSelectSkill,
      onSelectServiceSkill,
      onClearSkill,
      onNavigateToSettings,
      onImportSkill,
      onRefreshSkills,
    },
  };
}
