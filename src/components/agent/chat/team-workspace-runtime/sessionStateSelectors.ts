import type { TeamWorkspaceRuntimeStatus } from "../teamWorkspaceRuntime";

export interface TeamWorkspaceSessionStateSnapshot {
  id: string;
  sessionType?: string;
  runtimeStatus?: TeamWorkspaceRuntimeStatus;
}

export interface TeamWorkspaceSessionControlState {
  statusSummary: Record<string, number>;
  waitableSessionIds: string[];
  completedSessionIds: string[];
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
