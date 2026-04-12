import { useMemo } from "react";
import { buildTeamWorkspaceSelectedSessionActionState } from "../../team-workspace-runtime/sessionStateSelectors";
import type { TeamSessionCard } from "../../utils/teamWorkspaceSessions";

interface UseTeamWorkspaceBoardSelectedSessionActionStateParams {
  completedTeamSessionIds: string[];
  currentSessionId?: string | null;
  onCloseCompletedTeamSessions?: (sessionIds: string[]) => void | Promise<void>;
  onCloseSubagentSession?: (sessionId: string) => void | Promise<void>;
  onOpenSubagentSession?: (sessionId: string) => void | Promise<void>;
  onResumeSubagentSession?: (sessionId: string) => void | Promise<void>;
  onSendSubagentInput?: (
    sessionId: string,
    message: string,
    options?: { interrupt?: boolean },
  ) => void | Promise<void>;
  onWaitActiveTeamSessions?: (
    sessionIds: string[],
    timeoutMs?: number,
  ) => void | Promise<void>;
  onWaitSubagentSession?: (
    sessionId: string,
    timeoutMs?: number,
  ) => void | Promise<void>;
  selectedSession: TeamSessionCard | null;
  waitableTeamSessionIds: string[];
}

export function useTeamWorkspaceBoardSelectedSessionActionState({
  completedTeamSessionIds,
  currentSessionId,
  onCloseCompletedTeamSessions,
  onCloseSubagentSession,
  onOpenSubagentSession,
  onResumeSubagentSession,
  onSendSubagentInput,
  onWaitActiveTeamSessions,
  onWaitSubagentSession,
  selectedSession,
  waitableTeamSessionIds,
}: UseTeamWorkspaceBoardSelectedSessionActionStateParams) {
  return useMemo(
    () =>
      buildTeamWorkspaceSelectedSessionActionState({
        completedTeamSessionIds,
        currentSessionId,
        hasCloseCompletedTeamSessionsHandler: Boolean(
          onCloseCompletedTeamSessions,
        ),
        hasCloseSubagentSessionHandler: Boolean(onCloseSubagentSession),
        hasOpenSubagentSessionHandler: Boolean(onOpenSubagentSession),
        hasResumeSubagentSessionHandler: Boolean(onResumeSubagentSession),
        hasSendSubagentInputHandler: Boolean(onSendSubagentInput),
        hasWaitActiveTeamSessionsHandler: Boolean(onWaitActiveTeamSessions),
        hasWaitSubagentSessionHandler: Boolean(onWaitSubagentSession),
        selectedSession,
        waitableTeamSessionIds,
      }),
    [
      completedTeamSessionIds,
      currentSessionId,
      onCloseCompletedTeamSessions,
      onCloseSubagentSession,
      onOpenSubagentSession,
      onResumeSubagentSession,
      onSendSubagentInput,
      onWaitActiveTeamSessions,
      onWaitSubagentSession,
      selectedSession,
      waitableTeamSessionIds,
    ],
  );
}
