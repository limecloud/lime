import { useCallback } from "react";
import type { TeamSessionCard } from "../../utils/teamWorkspaceSessions";
import {
  useTeamWorkspaceBoardActionUiState,
} from "./useTeamWorkspaceBoardActionUiState";

interface UseTeamWorkspaceBoardActionsParams {
  completedTeamSessionIds: string[];
  onCloseCompletedTeamSessions?: (sessionIds: string[]) => void | Promise<void>;
  onCloseSubagentSession?: (sessionId: string) => void | Promise<void>;
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
  selectedSession?: Pick<TeamSessionCard, "id"> | null;
  waitTimeoutMs?: number;
  waitableTeamSessionIds: string[];
}

export function useTeamWorkspaceBoardActions({
  completedTeamSessionIds,
  onCloseCompletedTeamSessions,
  onCloseSubagentSession,
  onResumeSubagentSession,
  onSendSubagentInput,
  onWaitActiveTeamSessions,
  onWaitSubagentSession,
  selectedSession,
  waitTimeoutMs = 30_000,
  waitableTeamSessionIds,
}: UseTeamWorkspaceBoardActionsParams) {
  const {
    clearSelectedSessionInputDraft,
    handleSelectedSessionInputDraftChange,
    pendingSessionAction,
    pendingTeamAction,
    selectedActionPending,
    selectedSessionInputDraft,
    selectedSessionInputMessage,
    setPendingSessionAction,
    setPendingTeamAction,
  } = useTeamWorkspaceBoardActionUiState({
    selectedSession,
  });

  const handleWaitAnyActiveTeamSessions = useCallback(async () => {
    if (!onWaitActiveTeamSessions || waitableTeamSessionIds.length <= 1) {
      return;
    }

    setPendingTeamAction("wait_any");
    try {
      await onWaitActiveTeamSessions(waitableTeamSessionIds, waitTimeoutMs);
    } finally {
      setPendingTeamAction(null);
    }
  }, [
    onWaitActiveTeamSessions,
    setPendingTeamAction,
    waitTimeoutMs,
    waitableTeamSessionIds,
  ]);

  const handleCloseCompletedTeamSessions = useCallback(async () => {
    if (!onCloseCompletedTeamSessions || completedTeamSessionIds.length === 0) {
      return;
    }

    setPendingTeamAction("close_completed");
    try {
      await onCloseCompletedTeamSessions(completedTeamSessionIds);
    } finally {
      setPendingTeamAction(null);
    }
  }, [
    completedTeamSessionIds,
    onCloseCompletedTeamSessions,
    setPendingTeamAction,
  ]);

  const handleSelectedSessionAction = useCallback(
    async (action: "close" | "resume" | "wait") => {
      if (!selectedSession) {
        return;
      }

      setPendingSessionAction({ sessionId: selectedSession.id, action });
      try {
        if (action === "close") {
          await onCloseSubagentSession?.(selectedSession.id);
          return;
        }
        if (action === "resume") {
          await onResumeSubagentSession?.(selectedSession.id);
          return;
        }
        await onWaitSubagentSession?.(selectedSession.id, waitTimeoutMs);
      } finally {
        setPendingSessionAction((current) =>
          current?.sessionId === selectedSession.id ? null : current,
        );
      }
    },
    [
      onCloseSubagentSession,
      onResumeSubagentSession,
      onWaitSubagentSession,
      selectedSession,
      setPendingSessionAction,
      waitTimeoutMs,
    ],
  );

  const handleSelectedSessionSendInput = useCallback(
    async (interrupt: boolean) => {
      if (!selectedSession || !selectedSessionInputMessage) {
        return;
      }

      const action = interrupt ? "interrupt_send" : "send";
      const sessionId = selectedSession.id;
      setPendingSessionAction({ sessionId, action });
      try {
        await onSendSubagentInput?.(sessionId, selectedSessionInputMessage, {
          interrupt,
        });
        clearSelectedSessionInputDraft(sessionId);
      } finally {
        setPendingSessionAction((current) =>
          current?.sessionId === sessionId ? null : current,
        );
      }
    },
    [
      clearSelectedSessionInputDraft,
      onSendSubagentInput,
      selectedSession,
      selectedSessionInputMessage,
      setPendingSessionAction,
    ],
  );

  return {
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
  };
}
