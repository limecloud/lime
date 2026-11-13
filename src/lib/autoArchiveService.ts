import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import {
  archiveAgentRuntimeSession,
  listAgentRuntimeSessions,
} from "@/lib/api/agentRuntime/sessionClient";

const DAY_MS = 24 * 60 * 60 * 1000;

function updatedAtMs(session: AgentSessionInfo): number {
  const value = session.updated_at ?? session.created_at;
  if (!value || !Number.isFinite(value)) return 0;
  return value < 10_000_000_000 ? value * 1000 : value;
}

export async function archiveInactiveSessions({
  days,
  now,
  list = listAgentRuntimeSessions,
  archive = archiveAgentRuntimeSession,
}: {
  days: number;
  now: number;
  list?: typeof listAgentRuntimeSessions;
  archive?: typeof archiveAgentRuntimeSession;
}): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = now - days * DAY_MS;
  const sessions = await list({ limit: 200 });
  let archived = 0;
  for (const session of sessions) {
    if (session.archived_at) continue;
    if (updatedAtMs(session) >= cutoff) continue;
    await archive(session.id);
    archived += 1;
  }
  return archived;
}
