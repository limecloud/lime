import { useMemo } from "react";
import type {
  TeamWorkspaceControlSummary,
  TeamWorkspaceWaitSummary,
} from "../../teamWorkspaceRuntime";
import {
  buildTeamWorkspaceSessionControlState,
} from "../../team-workspace-runtime/sessionStateSelectors";
import {
  buildVisibleTeamOperationState,
  type TeamOperationDisplayEntry,
} from "../../team-workspace-runtime/teamOperationSelectors";
import type { TeamSessionCard } from "../../utils/teamWorkspaceSessions";

interface UseTeamWorkspaceBoardOperationStateParams {
  currentChildSession?: TeamSessionCard | null;
  currentSessionId?: string | null;
  isChildSession: boolean;
  railSessions: TeamSessionCard[];
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  visibleSessions: TeamSessionCard[];
}

interface TeamWorkspaceBoardOperationState {
  completedTeamSessionIds: string[];
  statusSummary: Record<string, number>;
  teamOperationEntries: TeamOperationDisplayEntry[];
  visibleTeamWaitSummary: TeamWorkspaceWaitSummary | null;
  waitableTeamSessionIds: string[];
}

export function useTeamWorkspaceBoardOperationState({
  currentChildSession = null,
  currentSessionId,
  isChildSession,
  railSessions,
  teamControlSummary = null,
  teamWaitSummary = null,
  visibleSessions,
}: UseTeamWorkspaceBoardOperationStateParams): TeamWorkspaceBoardOperationState {
  const teamOperationState = useMemo(
    () =>
      buildVisibleTeamOperationState({
        railSessions,
        teamWaitSummary,
        teamControlSummary,
      }),
    [railSessions, teamControlSummary, teamWaitSummary],
  );
  const sessionControlState = useMemo(
    () =>
      buildTeamWorkspaceSessionControlState({
        visibleSessions,
        railSessions,
        currentChildSession,
        isChildSession,
        currentSessionId,
      }),
    [
      currentChildSession,
      currentSessionId,
      isChildSession,
      railSessions,
      visibleSessions,
    ],
  );

  return {
    completedTeamSessionIds: sessionControlState.completedSessionIds,
    statusSummary: sessionControlState.statusSummary,
    teamOperationEntries: teamOperationState.entries,
    visibleTeamWaitSummary: teamOperationState.visibleTeamWaitSummary,
    waitableTeamSessionIds: sessionControlState.waitableSessionIds,
  };
}
