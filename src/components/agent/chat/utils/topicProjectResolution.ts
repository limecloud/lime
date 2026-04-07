export interface ResolveTopicProjectIdOptions {
  topicBoundProjectId?: string | null;
  lastProjectId?: string | null;
  defaultProjectId?: string | null;
}

const INVALID_PROJECT_IDS = new Set(["__invalid__", "[object Promise]"]);
const DEFAULT_PROJECT_ID_ALIAS = "default";

export function isDefaultProjectIdAlias(projectId: unknown): boolean {
  return (
    typeof projectId === "string" &&
    projectId.trim().toLowerCase() === DEFAULT_PROJECT_ID_ALIAS
  );
}

export function normalizeProjectId(projectId: unknown): string | null {
  if (typeof projectId !== "string") {
    return null;
  }

  const normalized = projectId.trim();
  if (
    !normalized ||
    INVALID_PROJECT_IDS.has(normalized) ||
    isDefaultProjectIdAlias(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function resolveTopicProjectId({
  topicBoundProjectId,
  lastProjectId,
  defaultProjectId,
}: ResolveTopicProjectIdOptions): string | null {
  return (
    normalizeProjectId(topicBoundProjectId) ||
    normalizeProjectId(lastProjectId) ||
    normalizeProjectId(defaultProjectId)
  );
}

export function isLockedProjectConflict(
  lockedProjectId: string | null | undefined,
  targetProjectId: string | null | undefined,
): boolean {
  const locked = normalizeProjectId(lockedProjectId);
  const target = normalizeProjectId(targetProjectId);

  if (!locked || !target) {
    return false;
  }

  return locked !== target;
}
