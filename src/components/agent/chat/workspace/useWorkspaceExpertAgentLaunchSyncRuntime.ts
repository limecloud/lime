import { useCallback, useEffect, useState } from "react";
import {
  updateExpertAgentInstanceSkillRefs,
} from "@/features/experts";
import type { ExpertAgentLaunchParams } from "@/types/page";
import { areStringArraysEqual } from "./agentChatWorkspaceHelpers";

interface UseWorkspaceExpertAgentLaunchSyncRuntimeParams {
  expertAgentLaunch?: ExpertAgentLaunchParams | null;
  expertPanelRequestMetadata: unknown;
  pruneWorkspaceSkillRuntimeEnableRefs: (skillRefs: string[]) => void;
}

export function resolveNextExpertSkillRefsOverride(
  current: string[] | null,
  skillRefs: string[],
): string[] | null {
  return areStringArraysEqual(current, skillRefs) ? current : [...skillRefs];
}

export function useWorkspaceExpertAgentLaunchSyncRuntime({
  expertAgentLaunch,
  expertPanelRequestMetadata,
  pruneWorkspaceSkillRuntimeEnableRefs,
}: UseWorkspaceExpertAgentLaunchSyncRuntimeParams) {
  const [expertSkillRefsOverride, setExpertSkillRefsOverride] = useState<
    string[] | null
  >(null);

  useEffect(() => {
    setExpertSkillRefsOverride(null);
  }, [expertPanelRequestMetadata]);

  const handleExpertSkillRefsChange = useCallback(
    (skillRefs: string[]) => {
      setExpertSkillRefsOverride((current) =>
        resolveNextExpertSkillRefsOverride(current, skillRefs),
      );
      pruneWorkspaceSkillRuntimeEnableRefs(skillRefs);
      if (!expertAgentLaunch) {
        return;
      }
      updateExpertAgentInstanceSkillRefs({
        catalogId: expertAgentLaunch.catalogId,
        projectId: expertAgentLaunch.projectId,
        expertId: expertAgentLaunch.expertId,
        releaseId: expertAgentLaunch.releaseId,
        catalogVersion: expertAgentLaunch.catalogVersion,
        skillRefsOverride: skillRefs,
      });
    },
    [expertAgentLaunch, pruneWorkspaceSkillRuntimeEnableRefs],
  );

  return {
    expertSkillRefsOverride,
    handleExpertSkillRefsChange,
  };
}
