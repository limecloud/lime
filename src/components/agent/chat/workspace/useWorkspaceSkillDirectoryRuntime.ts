import { useCallback, useRef } from "react";
import { useLimeSkills } from "../hooks/useLimeSkills";
import { useServiceSkills } from "../service-skills/useServiceSkills";
import { useWorkspaceServiceSkillDirectoryToastRuntime } from "./useWorkspaceEntrySideEffectsRuntime";

interface UseWorkspaceSkillDirectoryRuntimeParams {
  activeTheme: string;
  autoLoadServiceSkills: boolean;
  deferredDelayMs?: number;
  shouldDeferWorkspaceAuxiliaryLoads: boolean;
}

export function useWorkspaceSkillDirectoryRuntime({
  activeTheme,
  autoLoadServiceSkills,
  deferredDelayMs,
  shouldDeferWorkspaceAuxiliaryLoads,
}: UseWorkspaceSkillDirectoryRuntimeParams) {
  const skillSuggestionsRequestedRef = useRef(false);

  const {
    skills,
    skillsLoading,
    refreshSkills: loadSkills,
  } = useLimeSkills({
    autoLoad: false,
    deferredDelayMs,
    logScope: "LocalConversationPage",
    onError: (error) => {
      console.warn("[LocalConversationPage] 加载 skills 失败:", error);
    },
  });
  const {
    skills: serviceSkills,
    groups: serviceSkillGroups,
    isLoading: serviceSkillsLoading,
    error: serviceSkillsError,
    recordUsage: recordServiceSkillUsage,
  } = useServiceSkills({
    enabled: activeTheme === "general",
    autoLoad: autoLoadServiceSkills,
    loadMode: shouldDeferWorkspaceAuxiliaryLoads ? "deferred" : "immediate",
    deferredDelayMs,
  });

  useWorkspaceServiceSkillDirectoryToastRuntime({
    activeTheme,
    serviceSkillsError,
  });

  const handleRefreshSkills = useCallback(async () => {
    skillSuggestionsRequestedRef.current = true;
    await loadSkills(true);
  }, [loadSkills]);

  const handleSkillSuggestionsNeeded = useCallback(() => {
    if (skillSuggestionsRequestedRef.current) return;
    skillSuggestionsRequestedRef.current = true;
    void loadSkills(false);
  }, [loadSkills]);

  return {
    skills,
    skillsLoading,
    serviceSkills,
    serviceSkillGroups,
    serviceSkillsLoading,
    serviceSkillsError,
    recordServiceSkillUsage,
    handleRefreshSkills,
    handleSkillSuggestionsNeeded,
  };
}
