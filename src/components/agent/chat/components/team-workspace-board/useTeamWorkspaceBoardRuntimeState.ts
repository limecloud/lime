import { useCallback, useMemo } from "react";
import type {
  TeamWorkspaceControlSummary,
  TeamWorkspaceWaitSummary,
} from "../../teamWorkspaceRuntime";
import {
  buildTeamWorkspaceSelectedSessionActionState,
  buildTeamWorkspaceSessionControlState,
} from "../../team-workspace-runtime/sessionStateSelectors";
import {
  buildVisibleTeamOperationState,
  type TeamOperationDisplayEntry,
} from "../../team-workspace-runtime/teamOperationSelectors";
import type { TeamSessionCard } from "../../utils/teamWorkspaceSessions";
import { useTeamWorkspaceBoardActions } from "./useTeamWorkspaceBoardActions";
import { useTeamWorkspaceSessionFocus } from "./useTeamWorkspaceSessionFocus";

interface UseTeamWorkspaceBoardRuntimeStateParams {
  baseRailSessions: TeamSessionCard[];
  currentChildSession?: TeamSessionCard | null;
  currentSessionId?: string | null;
  isChildSession: boolean;
  memberCanvasSessions: TeamSessionCard[];
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
  orchestratorSessionId?: string | null;
  railSessions: TeamSessionCard[];
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  visibleSessions: TeamSessionCard[];
  waitTimeoutMs?: number;
}

export function useTeamWorkspaceBoardRuntimeState({
  baseRailSessions,
  currentChildSession = null,
  currentSessionId,
  isChildSession,
  memberCanvasSessions,
  onCloseCompletedTeamSessions,
  onCloseSubagentSession,
  onOpenSubagentSession,
  onResumeSubagentSession,
  onSendSubagentInput,
  onWaitActiveTeamSessions,
  onWaitSubagentSession,
  orchestratorSessionId,
  railSessions,
  teamControlSummary = null,
  teamWaitSummary = null,
  visibleSessions,
  waitTimeoutMs = 30_000,
}: UseTeamWorkspaceBoardRuntimeStateParams) {
  const teamOperationState = useMemo(
    () =>
      buildVisibleTeamOperationState({
        railSessions,
        teamWaitSummary,
        teamControlSummary,
      }),
    [railSessions, teamControlSummary, teamWaitSummary],
  );
  const visibleTeamWaitSummary = teamOperationState.visibleTeamWaitSummary;
  const teamOperationEntries = teamOperationState.entries;

  const {
    expandedSessionId,
    focusSession,
    selectedBaseSession,
    selectedSession,
  } = useTeamWorkspaceSessionFocus({
    baseRailSessions,
    currentSessionId,
    isChildSession,
    memberCanvasSessions,
    orchestratorSessionId,
    railSessions,
    visibleTeamWaitSummary,
  });

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
  const statusSummary = sessionControlState.statusSummary;
  const waitableTeamSessionIds = sessionControlState.waitableSessionIds;
  const completedTeamSessionIds = sessionControlState.completedSessionIds;

  const sessionActionState = useMemo(
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
  const canCloseCompletedTeamSessions =
    sessionActionState.canCloseCompletedTeamSessions;
  const canOpenSelectedSession = sessionActionState.canOpenSelectedSession;
  const canResumeSelectedSession =
    sessionActionState.canResumeSelectedSession;
  const canSendSelectedSessionInput =
    sessionActionState.canSendSelectedSessionInput;
  const canStopSelectedSession = sessionActionState.canStopSelectedSession;
  const canWaitAnyActiveTeamSession =
    sessionActionState.canWaitAnyActiveTeamSession;
  const canWaitSelectedSession = sessionActionState.canWaitSelectedSession;

  const {
    handleCloseCompletedTeamSessions,
    handleSelectedSessionAction,
    handleSelectedSessionInputDraftChange,
    handleSelectedSessionSendInput,
    handleWaitAnyActiveTeamSessions,
    pendingSessionAction,
    pendingTeamAction,
    selectedActionPending,
    selectedSessionInputDraft,
    selectedSessionInputMessage,
  } = useTeamWorkspaceBoardActions({
    completedTeamSessionIds,
    onCloseCompletedTeamSessions,
    onCloseSubagentSession,
    onResumeSubagentSession,
    onSendSubagentInput,
    onWaitActiveTeamSessions,
    onWaitSubagentSession,
    selectedSession,
    waitTimeoutMs,
    waitableTeamSessionIds,
  });

  const handleSelectTeamOperationEntry = useCallback(
    (entry: TeamOperationDisplayEntry) => {
      if (!entry.targetSessionId) {
        return;
      }
      focusSession(entry.targetSessionId);
    },
    [focusSession],
  );

  return {
    canCloseCompletedTeamSessions,
    canOpenSelectedSession,
    canResumeSelectedSession,
    canSendSelectedSessionInput,
    canStopSelectedSession,
    canWaitAnyActiveTeamSession,
    canWaitSelectedSession,
    completedTeamSessionIds,
    expandedSessionId,
    focusSession,
    handleCloseCompletedTeamSessions,
    handleSelectTeamOperationEntry,
    handleSelectedSessionAction,
    handleSelectedSessionInputDraftChange,
    handleSelectedSessionSendInput,
    handleWaitAnyActiveTeamSessions,
    pendingSessionAction,
    pendingTeamAction,
    selectedActionPending,
    selectedBaseSession,
    selectedSession,
    selectedSessionInputDraft,
    selectedSessionInputMessage,
    statusSummary,
    teamOperationEntries,
    visibleTeamWaitSummary,
    waitableTeamSessionIds,
  };
}
