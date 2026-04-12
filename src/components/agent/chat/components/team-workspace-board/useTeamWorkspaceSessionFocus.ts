import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TeamWorkspaceWaitSummary } from "../../teamWorkspaceRuntime";
import {
  resolveExpandedTeamWorkspaceSessionId,
  resolveTeamWorkspaceSelectedSessionId,
  type TeamSessionCard,
} from "../../utils/teamWorkspaceSessions";

interface UseTeamWorkspaceSessionFocusParams {
  baseRailSessions: TeamSessionCard[];
  currentSessionId?: string | null;
  isChildSession: boolean;
  memberCanvasSessions: TeamSessionCard[];
  orchestratorSessionId?: string | null;
  railSessions: TeamSessionCard[];
  visibleTeamWaitSummary?: TeamWorkspaceWaitSummary | null;
}

export function useTeamWorkspaceSessionFocus({
  baseRailSessions,
  currentSessionId,
  isChildSession,
  memberCanvasSessions,
  orchestratorSessionId,
  railSessions,
  visibleTeamWaitSummary = null,
}: UseTeamWorkspaceSessionFocusParams) {
  const lastAutoFocusedTeamWaitKeyRef = useRef<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => railSessions[0]?.id ?? null,
  );
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const nextSelectedSessionId = resolveTeamWorkspaceSelectedSessionId({
      currentSessionId,
      isChildSession,
      selectedSessionId,
      railSessions,
      memberCanvasSessions,
      orchestratorSessionId,
    });
    if (nextSelectedSessionId !== selectedSessionId) {
      setSelectedSessionId(nextSelectedSessionId);
    }
  }, [
    currentSessionId,
    isChildSession,
    memberCanvasSessions,
    orchestratorSessionId,
    railSessions,
    selectedSessionId,
  ]);

  useEffect(() => {
    const nextExpandedSessionId = resolveExpandedTeamWorkspaceSessionId(
      expandedSessionId,
      memberCanvasSessions,
    );
    if (nextExpandedSessionId !== expandedSessionId) {
      setExpandedSessionId(nextExpandedSessionId);
    }
  }, [expandedSessionId, memberCanvasSessions]);

  const focusSession = useCallback(
    (sessionId: string) => {
      if (!railSessions.some((session) => session.id === sessionId)) {
        return;
      }
      setSelectedSessionId(sessionId);
      setExpandedSessionId(sessionId);
    },
    [railSessions],
  );

  useEffect(() => {
    if (
      !visibleTeamWaitSummary?.resolvedSessionId ||
      visibleTeamWaitSummary.timedOut
    ) {
      return;
    }

    const waitFocusKey = [
      visibleTeamWaitSummary.updatedAt,
      visibleTeamWaitSummary.resolvedSessionId,
      visibleTeamWaitSummary.resolvedStatus ?? "idle",
    ].join(":");
    if (lastAutoFocusedTeamWaitKeyRef.current === waitFocusKey) {
      return;
    }

    if (
      railSessions.some(
        (session) => session.id === visibleTeamWaitSummary.resolvedSessionId,
      )
    ) {
      lastAutoFocusedTeamWaitKeyRef.current = waitFocusKey;
      focusSession(visibleTeamWaitSummary.resolvedSessionId);
    }
  }, [focusSession, railSessions, visibleTeamWaitSummary]);

  const selectedSession = useMemo(
    () =>
      railSessions.find((session) => session.id === selectedSessionId) ??
      railSessions[0] ??
      null,
    [railSessions, selectedSessionId],
  );
  const selectedBaseSession = useMemo(
    () =>
      baseRailSessions.find((session) => session.id === selectedSessionId) ??
      baseRailSessions[0] ??
      null,
    [baseRailSessions, selectedSessionId],
  );

  return {
    expandedSessionId,
    focusSession,
    selectedBaseSession,
    selectedSession,
  };
}
