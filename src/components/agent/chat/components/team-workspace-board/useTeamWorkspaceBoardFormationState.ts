import { useMemo } from "react";
import type {
  TeamWorkspaceRuntimeFormationDisplayState,
  TeamWorkspaceSelectedTeamPlanDisplayState,
} from "../../team-workspace-runtime/formationDisplaySelectors";
import {
  buildRuntimeFormationDisplayState,
  buildSelectedTeamPlanDisplayState,
} from "../../team-workspace-runtime/formationDisplaySelectors";
import type { TeamWorkspaceRuntimeFormationState } from "../../teamWorkspaceRuntime";
import type { TeamRoleDefinition } from "../../utils/teamDefinitions";

interface UseTeamWorkspaceBoardFormationStateParams {
  selectedTeamLabel?: string | null;
  selectedTeamRoles?: TeamRoleDefinition[] | null;
  selectedTeamSummary?: string | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
}

interface TeamWorkspaceBoardFormationState {
  hasRuntimeFormation: boolean;
  hasSelectedTeamPlan: boolean;
  plannedRoles: TeamRoleDefinition[];
  runtimeFormationDisplay: TeamWorkspaceRuntimeFormationDisplayState;
  selectedTeamPlanDisplay: TeamWorkspaceSelectedTeamPlanDisplayState;
}

export function useTeamWorkspaceBoardFormationState({
  selectedTeamLabel = null,
  selectedTeamRoles = [],
  selectedTeamSummary = null,
  teamDispatchPreviewState = null,
}: UseTeamWorkspaceBoardFormationStateParams): TeamWorkspaceBoardFormationState {
  const normalizedSelectedTeamLabel = selectedTeamLabel?.trim() || null;
  const normalizedSelectedTeamSummary = selectedTeamSummary?.trim() || null;
  const plannedRoles = useMemo(
    () => (selectedTeamRoles ?? []).filter((role) => role.label.trim()),
    [selectedTeamRoles],
  );
  const selectedTeamPlanDisplay = useMemo(
    () =>
      buildSelectedTeamPlanDisplayState({
        selectedTeamLabel: normalizedSelectedTeamLabel,
        selectedTeamSummary: normalizedSelectedTeamSummary,
        selectedTeamRoles: plannedRoles,
      }),
    [normalizedSelectedTeamLabel, normalizedSelectedTeamSummary, plannedRoles],
  );
  const runtimeFormationDisplay = useMemo(
    () =>
      buildRuntimeFormationDisplayState({
        teamDispatchPreviewState,
        fallbackLabel: normalizedSelectedTeamLabel,
        fallbackSummary: normalizedSelectedTeamSummary,
      }),
    [
      normalizedSelectedTeamLabel,
      normalizedSelectedTeamSummary,
      teamDispatchPreviewState,
    ],
  );

  return {
    hasRuntimeFormation: runtimeFormationDisplay.hasRuntimeFormation,
    hasSelectedTeamPlan: selectedTeamPlanDisplay.hasSelectedTeamPlan,
    plannedRoles,
    runtimeFormationDisplay,
    selectedTeamPlanDisplay,
  };
}
