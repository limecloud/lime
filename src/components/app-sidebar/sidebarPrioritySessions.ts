import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import { resolveUnfinishedSessionProjection } from "../agent/chat/projection/unfinishedSessionProjection";
import { isSessionUnread } from "@/lib/sessionUnreadState";

export function isPrioritySession(session: AgentSessionInfo): boolean {
  if (isSessionUnread(session)) return true;
  const status = resolveUnfinishedSessionProjection(session)?.status;
  return (
    status === "running" ||
    status === "queued" ||
    status === "waitingAction"
  );
}

export function selectPrioritySessions(
  sessions: readonly AgentSessionInfo[],
  limit = 5,
): AgentSessionInfo[] {
  return sessions.filter(isPrioritySession).slice(0, limit);
}
