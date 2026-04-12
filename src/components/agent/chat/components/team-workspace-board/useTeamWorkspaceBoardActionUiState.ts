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

interface UseTeamWorkspaceBoardActionUiStateParams {
  selectedSession?: Pick<TeamSessionCard, "id"> | null;
}

export function useTeamWorkspaceBoardActionUiState({
  selectedSession,
}: UseTeamWorkspaceBoardActionUiStateParams) {
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

  const clearSelectedSessionInputDraft = useCallback((sessionId: string) => {
    setSessionInputDraftById((previous) => {
      if (!previous[sessionId]) {
        return previous;
      }
      return {
        ...previous,
        [sessionId]: "",
      };
    });
  }, []);

  return {
    clearSelectedSessionInputDraft,
    handleSelectedSessionInputDraftChange,
    pendingSessionAction,
    pendingTeamAction,
    selectedActionPending,
    selectedSessionInputDraft,
    selectedSessionInputMessage,
    setPendingSessionAction,
    setPendingTeamAction,
  };
}
