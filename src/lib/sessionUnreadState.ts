import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";

const READ_AT_KEY_PREFIX = "lime.session.readAt.";

export function markSessionRead(sessionId: string): void {
  if (typeof window === "undefined") return;
  const normalized = sessionId.trim();
  if (!normalized) return;
  window.localStorage.setItem(
    `${READ_AT_KEY_PREFIX}${normalized}`,
    String(Date.now()),
  );
}

export function isSessionUnread(session: AgentSessionInfo): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(
    `${READ_AT_KEY_PREFIX}${session.id}`,
  );
  if (!raw) return false;
  const readAt = Number(raw);
  if (!Number.isFinite(readAt)) return false;
  const updatedAtMs =
    session.updated_at < 1e12
      ? session.updated_at * 1000
      : session.updated_at;
  return updatedAtMs > readAt;
}
