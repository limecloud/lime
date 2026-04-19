import type { Skill } from "@/lib/api/skills";
import type {
  ServiceSkillGroup,
  ServiceSkillHomeItem,
} from "@/components/agent/chat/service-skills/types";

export interface SkillSelectionSourceProps {
  skills?: Skill[];
  serviceSkills?: ServiceSkillHomeItem[];
  serviceSkillGroups?: ServiceSkillGroup[];
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
  serviceSkillGroups: ServiceSkillGroup[];
  activeSkill: Skill | null;
  isSkillsLoading: boolean;
}

export function createSkillSelectionProps({
  skills = [],
  serviceSkills = [],
  serviceSkillGroups = [],
  activeSkill = null,
  isSkillsLoading = false,
  ...rest
}: SkillSelectionSourceProps &
  SkillSelectionControllerProps): SkillSelectionProps {
  return {
    ...rest,
    skills,
    serviceSkills,
    serviceSkillGroups,
    activeSkill,
    isSkillsLoading,
  };
}

export function buildSkillSelectionProps(
  props: SkillSelectionSourceProps & SkillSelectionControllerProps,
): SkillSelectionProps {
  return createSkillSelectionProps(props);
}

export function buildSkillSelectionBindings({
  skills,
  serviceSkills = [],
  serviceSkillGroups = [],
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
      serviceSkillGroups,
      onSelectServiceSkill,
      onNavigateToSettings,
    },
    selectorProps: {
      skills,
      serviceSkills,
      serviceSkillGroups,
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
