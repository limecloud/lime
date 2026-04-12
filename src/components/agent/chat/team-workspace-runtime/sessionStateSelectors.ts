import {
  isTeamWorkspaceActiveStatus,
  type TeamWorkspaceRuntimeStatus,
} from "../teamWorkspaceRuntime";

export interface TeamWorkspaceSessionStateSnapshot {
  id: string;
  sessionType?: string;
  latestTurnStatus?: TeamWorkspaceRuntimeStatus;
  runtimeStatus?: TeamWorkspaceRuntimeStatus;
}

export interface TeamWorkspaceSessionControlState {
  statusSummary: Record<string, number>;
  waitableSessionIds: string[];
  completedSessionIds: string[];
}

export interface TeamWorkspaceSelectedSessionActionState {
  canCloseCompletedTeamSessions: boolean;
  canOpenSelectedSession: boolean;
  canResumeSelectedSession: boolean;
  canSendSelectedSessionInput: boolean;
  canStopSelectedSession: boolean;
  canWaitAnyActiveTeamSession: boolean;
  canWaitSelectedSession: boolean;
}

function dedupeSessions<T extends TeamWorkspaceSessionStateSnapshot>(
  sessions: Array<T | null | undefined>,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  sessions.forEach((session) => {
    if (!session || seen.has(session.id)) {
      return;
    }
    seen.add(session.id);
    result.push(session);
  });

  return result;
}

export function isWaitableTeamSession(
  session?: TeamWorkspaceSessionStateSnapshot | null,
) {
  return Boolean(
    session &&
    session.sessionType !== "user" &&
    session.runtimeStatus !== "completed" &&
    session.runtimeStatus !== "failed" &&
    session.runtimeStatus !== "aborted" &&
    session.runtimeStatus !== "closed",
  );
}

export function isCompletedTeamSession(
  session?: TeamWorkspaceSessionStateSnapshot | null,
) {
  return (
    session?.runtimeStatus === "completed" ||
    session?.runtimeStatus === "failed" ||
    session?.runtimeStatus === "aborted"
  );
}

export function buildTeamWorkspaceSessionControlState(
  params: {
    visibleSessions: TeamWorkspaceSessionStateSnapshot[];
    railSessions: TeamWorkspaceSessionStateSnapshot[];
    currentChildSession?: TeamWorkspaceSessionStateSnapshot | null;
    isChildSession: boolean;
    currentSessionId?: string | null;
  },
): TeamWorkspaceSessionControlState {
  const statusSummarySessions = params.isChildSession
    ? dedupeSessions([params.currentChildSession, ...params.visibleSessions])
    : params.visibleSessions;

  return {
    statusSummary: statusSummarySessions.reduce(
      (summary, session) => {
        const key = session.runtimeStatus ?? "idle";
        summary[key] = (summary[key] ?? 0) + 1;
        return summary;
      },
      {} as Record<string, number>,
    ),
    waitableSessionIds: params.railSessions
      .filter((session) => isWaitableTeamSession(session))
      .map((session) => session.id),
    completedSessionIds: params.railSessions
      .filter(
        (session) =>
          session.id !== params.currentSessionId && isCompletedTeamSession(session),
      )
      .map((session) => session.id),
  };
}

export function buildTeamWorkspaceSelectedSessionActionState(params: {
  completedTeamSessionIds: string[];
  currentSessionId?: string | null;
  hasCloseCompletedTeamSessionsHandler: boolean;
  hasCloseSubagentSessionHandler: boolean;
  hasOpenSubagentSessionHandler: boolean;
  hasResumeSubagentSessionHandler: boolean;
  hasSendSubagentInputHandler: boolean;
  hasWaitActiveTeamSessionsHandler: boolean;
  hasWaitSubagentSessionHandler: boolean;
  selectedSession?: TeamWorkspaceSessionStateSnapshot | null;
  waitableTeamSessionIds: string[];
}): TeamWorkspaceSelectedSessionActionState {
  const { selectedSession } = params;

  return {
    canWaitAnyActiveTeamSession:
      params.hasWaitActiveTeamSessionsHandler &&
      params.waitableTeamSessionIds.length > 1,
    canCloseCompletedTeamSessions:
      params.hasCloseCompletedTeamSessionsHandler &&
      params.completedTeamSessionIds.length > 0,
    canOpenSelectedSession: Boolean(
      selectedSession &&
        params.hasOpenSubagentSessionHandler &&
        selectedSession.id !== params.currentSessionId,
    ),
    canWaitSelectedSession: Boolean(
      selectedSession &&
        params.hasWaitSubagentSessionHandler &&
        isWaitableTeamSession(selectedSession),
    ),
    canSendSelectedSessionInput: Boolean(
      selectedSession &&
        selectedSession.sessionType !== "user" &&
        selectedSession.runtimeStatus !== "closed" &&
        params.hasSendSubagentInputHandler &&
        selectedSession.id !== params.currentSessionId,
    ),
    canStopSelectedSession: Boolean(
      selectedSession &&
        selectedSession.sessionType !== "user" &&
        params.hasCloseSubagentSessionHandler &&
        isTeamWorkspaceActiveStatus(
          selectedSession.runtimeStatus ?? selectedSession.latestTurnStatus,
        ),
    ),
    canResumeSelectedSession: Boolean(
      selectedSession &&
        selectedSession.sessionType !== "user" &&
        selectedSession.runtimeStatus === "closed" &&
        params.hasResumeSubagentSessionHandler,
    ),
  };
}
