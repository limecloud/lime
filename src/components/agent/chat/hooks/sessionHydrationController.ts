export const SESSION_DETAIL_HISTORY_LIMIT = 40;

export interface SessionDetailHydrationOptions {
  historyLimit: number;
  resumeSessionStartHooks?: true;
}

export interface SessionDetailPrefetchTopicLike {
  updatedAt?: Date | null;
  messagesCount?: number | null;
}

export function normalizeSessionDetailHistoryLimit(
  value: number | null | undefined,
): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return SESSION_DETAIL_HISTORY_LIMIT;
  }
  return Math.trunc(value);
}

export function buildSessionDetailHydrationOptions(params?: {
  resumeSessionStartHooks?: boolean;
  historyLimit?: number | null;
}): SessionDetailHydrationOptions {
  const options: SessionDetailHydrationOptions = {
    historyLimit: normalizeSessionDetailHistoryLimit(params?.historyLimit),
  };
  if (params?.resumeSessionStartHooks) {
    options.resumeSessionStartHooks = true;
  }
  return options;
}

export function buildSessionDetailPrefetchKey(
  workspaceId: string,
  topicId: string,
): string {
  return `${workspaceId.trim() || "global"}:${topicId.trim()}`;
}

export function buildSessionDetailPrefetchSignature(
  topicId: string,
  topic?: SessionDetailPrefetchTopicLike | null,
): string {
  return [
    topicId.trim(),
    topic?.updatedAt?.getTime() ?? "unknown-updated",
    topic?.messagesCount ?? "unknown-count",
  ].join(":");
}

export function isCurrentSessionHydrationRequest(params: {
  currentRequestVersion?: number | null;
  requestVersion?: number | null;
  currentSessionId?: string | null;
  targetSessionId?: string | null;
}): boolean {
  if (
    params.requestVersion !== undefined &&
    params.requestVersion !== null &&
    params.currentRequestVersion !== params.requestVersion
  ) {
    return false;
  }

  const targetSessionId = params.targetSessionId?.trim();
  if (!targetSessionId) {
    return true;
  }

  return params.currentSessionId?.trim() === targetSessionId;
}
