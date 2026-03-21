import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceSettings } from "@/types/workspace";
import type { TeamDefinition } from "../utils/teamDefinitions";
import {
  buildTeamDefinitionLabel,
  buildTeamDefinitionSummary,
  createTeamDefinitionFromPreset,
} from "../utils/teamDefinitions";
import {
  persistSelectedTeam,
  resolveSelectedTeamPreference,
} from "../utils/teamStorage";

interface UseSelectedTeamPreferenceOptions {
  projectSettings?: WorkspaceSettings | null;
  onPersistSelectedTeam?: (team: TeamDefinition | null) => void | Promise<void>;
}

export function useSelectedTeamPreference(
  theme?: string | null,
  options: UseSelectedTeamPreferenceOptions = {},
) {
  const { projectSettings, onPersistSelectedTeam } = options;
  const resolveCurrentSelection = useCallback(
    () =>
      resolveSelectedTeamPreference({
        theme,
        workspaceSettings: projectSettings,
      }),
    [projectSettings, theme],
  );
  const [selectedTeam, setSelectedTeamState] = useState<TeamDefinition | null>(
    () => resolveCurrentSelection(),
  );

  useEffect(() => {
    setSelectedTeamState(resolveCurrentSelection());
  }, [resolveCurrentSelection]);

  const setSelectedTeam = useCallback(
    (team: TeamDefinition | null) => {
      setSelectedTeamState(team);

      if (onPersistSelectedTeam && team?.source !== "ephemeral") {
        const fallbackTeam = resolveCurrentSelection();
        void Promise.resolve(onPersistSelectedTeam(team)).catch((error) => {
          console.warn("[Team] 持久化项目级 Team 偏好失败:", error);
          setSelectedTeamState(fallbackTeam);
        });
        return;
      }

      if (onPersistSelectedTeam && team?.source === "ephemeral") {
        return;
      }

      persistSelectedTeam(team, theme);
    },
    [onPersistSelectedTeam, resolveCurrentSelection, theme],
  );

  const enableSuggestedTeam = useCallback(
    (suggestedPresetId?: string) => {
      const resolvedPresetId = suggestedPresetId?.trim();
      if (!resolvedPresetId) {
        return;
      }

      const suggestedTeam = createTeamDefinitionFromPreset(resolvedPresetId);
      if (suggestedTeam) {
        setSelectedTeam(suggestedTeam);
      }
    },
    [setSelectedTeam],
  );

  const preferredTeamPresetId = useMemo(
    () =>
      selectedTeam?.presetId?.trim() ||
      (selectedTeam?.source === "builtin" ? selectedTeam.id : undefined),
    [selectedTeam],
  );
  const selectedTeamLabel = useMemo(
    () => buildTeamDefinitionLabel(selectedTeam) || undefined,
    [selectedTeam],
  );
  const selectedTeamSummary = useMemo(
    () => buildTeamDefinitionSummary(selectedTeam) || undefined,
    [selectedTeam],
  );

  return {
    selectedTeam,
    setSelectedTeam,
    enableSuggestedTeam,
    preferredTeamPresetId,
    selectedTeamLabel,
    selectedTeamSummary,
  };
}
