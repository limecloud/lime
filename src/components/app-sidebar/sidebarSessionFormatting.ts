import type { AsterSessionInfo } from "@/lib/api/agentRuntime";

function formatSidebarSessionTime(updatedAt: number): string {
  const diffMs = Date.now() - updatedAt * 1000;
  const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));

  if (diffMinutes < 60) {
    return `${diffMinutes}分`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}时`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}天`;
  }

  return new Date(updatedAt * 1000).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

export function formatSidebarSessionMeta(session: AsterSessionInfo): string {
  if (typeof session.archived_at === "number" && session.archived_at > 0) {
    return `归档 ${formatSidebarSessionTime(session.archived_at)}`;
  }

  return formatSidebarSessionTime(session.updated_at);
}

export function resolveSidebarSessionTitle(session: AsterSessionInfo): string {
  return session.name?.trim() || "未命名对话";
}
