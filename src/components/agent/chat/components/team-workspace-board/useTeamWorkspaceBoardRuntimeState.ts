import { useCallback } from "react";
import type {
  TeamWorkspaceControlSummary,
  TeamWorkspaceWaitSummary,
} from "../../teamWorkspaceRuntime";
import type { TeamOperationDisplayEntry } from "../../team-workspace-runtime/teamOperationSelectors";
import type { TeamSessionCard } from "../../utils/teamWorkspaceSessions";
import { useTeamWorkspaceBoardActions } from "./useTeamWorkspaceBoardActions";
import { useTeamWorkspaceBoardOperationState } from "./useTeamWorkspaceBoardOperationState";
import { useTeamWorkspaceBoardSelectedSessionActionState } from "./useTeamWorkspaceBoardSelectedSessionActionState";
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
  const {
    completedTeamSessionIds,
    statusSummary,
    teamOperationEntries,
    visibleTeamWaitSummary,
    waitableTeamSessionIds,
  } = useTeamWorkspaceBoardOperationState({
    currentChildSession,
    currentSessionId,
    isChildSession,
    railSessions,
    teamControlSummary,
    teamWaitSummary,
    visibleSessions,
  });

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

  const {
    canCloseCompletedTeamSessions,
    canOpenSelectedSession,
    canResumeSelectedSession,
    canSendSelectedSessionInput,
    canStopSelectedSession,
    canWaitAnyActiveTeamSession,
    canWaitSelectedSession,
  } = useTeamWorkspaceBoardSelectedSessionActionState({
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
  });

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
