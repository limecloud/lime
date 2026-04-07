export interface RecoverableAsterSession {
  id: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ResolveRestorableSessionIdOptions {
  candidateSessionId?: string | null;
  sessions: RecoverableAsterSession[];
}

function toEpochSecond(value?: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value);
}

export function sortSessionsByRecency(
  sessions: RecoverableAsterSession[],
): RecoverableAsterSession[] {
  return [...sessions].sort((a, b) => {
    const bRank = toEpochSecond(b.updatedAt) || toEpochSecond(b.createdAt);
    const aRank = toEpochSecond(a.updatedAt) || toEpochSecond(a.createdAt);
    return bRank - aRank;
  });
}

export function resolveRestorableSessionId({
  candidateSessionId,
  sessions,
}: ResolveRestorableSessionIdOptions): string | null {
  const normalizedCandidate = candidateSessionId?.trim();
  if (normalizedCandidate) {
    const matched = sessions.some(
      (session) => session.id === normalizedCandidate,
    );
    if (matched) {
      return normalizedCandidate;
    }
  }

  const [fallback] = sortSessionsByRecency(sessions);
  return fallback?.id ?? null;
}

export function isAsterSessionNotFoundError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error ?? "");
  const normalized = message.toLowerCase();

  return (
    message.includes("会话不存在") ||
    normalized.includes("session not found") ||
    normalized.includes("no such session")
  );
}
