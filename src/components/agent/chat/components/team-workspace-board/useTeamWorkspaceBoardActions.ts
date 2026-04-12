import { useCallback, useMemo, useState } from "react";
import type { TeamSessionCard } from "../../utils/teamWorkspaceSessions";

export type TeamWorkspacePendingSessionAction =
  | "close"
  | "interrupt_send"
  | "resume"
  | "send"
  | "wait";

export type TeamWorkspacePendingTeamAction =
  | "close_completed"
  | "wait_any";

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
  const [pendingSessionAction, setPendingSessionAction] = useState<{
    sessionId: string;
    action: TeamWorkspacePendingSessionAction;
  } | null>(null);
  const [pendingTeamAction, setPendingTeamAction] =
    useState<TeamWorkspacePendingTeamAction | null>(null);
  const [sessionInputDraftById, setSessionInputDraftById] = useState<
    Record<string, string>
  >({});

  const selectedActionPending = Boolean(
    selectedSession && pendingSessionAction?.sessionId === selectedSession.id,
  );
  const selectedSessionInputDraft = selectedSession
    ? (sessionInputDraftById[selectedSession.id] ?? "")
    : "";
  const selectedSessionInputMessage = useMemo(
    () => selectedSessionInputDraft.trim(),
    [selectedSessionInputDraft],
  );

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
  }, [onWaitActiveTeamSessions, waitTimeoutMs, waitableTeamSessionIds]);

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
  }, [completedTeamSessionIds, onCloseCompletedTeamSessions]);

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
      waitTimeoutMs,
    ],
  );

  const handleSelectedSessionInputDraftChange = useCallback(
    (value: string) => {
      if (!selectedSession) {
        return;
      }

      setSessionInputDraftById((previous) => {
        if (previous[selectedSession.id] === value) {
          return previous;
        }
        return {
          ...previous,
          [selectedSession.id]: value,
        };
      });
    },
    [selectedSession],
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
        setSessionInputDraftById((previous) => {
          if (!previous[sessionId]) {
            return previous;
          }
          return {
            ...previous,
            [sessionId]: "",
          };
        });
      } finally {
        setPendingSessionAction((current) =>
          current?.sessionId === sessionId ? null : current,
        );
      }
    },
    [onSendSubagentInput, selectedSession, selectedSessionInputMessage],
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
