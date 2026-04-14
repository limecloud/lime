import { useCallback, useEffect, useState } from "react";
import { normalizeProjectId } from "../utils/topicProjectResolution";

export const LAST_PROJECT_ID_KEY = "agent_last_project_id";
export const SESSION_WORKSPACE_STORAGE_KEY_PREFIX = "agent_session_workspace_";

export function getSessionWorkspaceStorageKey(
  sessionId: string,
): string | null {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }

  return `${SESSION_WORKSPACE_STORAGE_KEY_PREFIX}${normalizedSessionId}`;
}

export function loadPersistedProjectId(key: string): string | null {
  try {
    return normalizeProjectId(loadStoredProjectIdRaw(key));
  } catch {
    return null;
  }
}

export function loadStoredProjectIdRaw(key: string): string | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored);
      const normalized =
        typeof parsed === "string" ? parsed.trim() : String(stored).trim();
      return normalized || null;
    } catch {
      const normalized = stored.trim();
      return normalized || null;
    }
  } catch {
    return null;
  }
}

export function savePersistedProjectId(key: string, projectId: string): void {
  const normalized = normalizeProjectId(projectId);
  if (!normalized) {
    return;
  }

  try {
    localStorage.setItem(key, JSON.stringify(normalized));
  } catch {
    // ignore write errors
  }
}

export function loadPersistedSessionWorkspaceId(
  sessionId: string,
): string | null {
  const key = getSessionWorkspaceStorageKey(sessionId);
  if (!key) {
    return null;
  }

  return loadPersistedProjectId(key);
}

export function loadStoredSessionWorkspaceIdRaw(
  sessionId: string,
): string | null {
  const key = getSessionWorkspaceStorageKey(sessionId);
  if (!key) {
    return null;
  }

  return loadStoredProjectIdRaw(key);
}

export function savePersistedSessionWorkspaceId(
  sessionId: string,
  projectId: string,
): void {
  const key = getSessionWorkspaceStorageKey(sessionId);
  if (!key) {
    return;
  }

  savePersistedProjectId(key, projectId);
}

export function usePersistedProjectId(
  externalProjectId?: string | null,
  storageKey = LAST_PROJECT_ID_KEY,
) {
  const resolveProjectId = useCallback(
    () =>
      normalizeProjectId(externalProjectId) ??
      loadPersistedProjectId(storageKey),
    [externalProjectId, storageKey],
  );
  const [projectId, setProjectIdState] = useState<string | null>(() =>
    resolveProjectId(),
  );

  useEffect(() => {
    setProjectIdState(resolveProjectId());
  }, [resolveProjectId]);

  const setProjectId = useCallback((nextProjectId?: string | null) => {
    setProjectIdState(normalizeProjectId(nextProjectId));
  }, []);

  const rememberProjectId = useCallback(
    (nextProjectId?: string | null) => {
      const normalized = normalizeProjectId(nextProjectId);
      if (!normalized) {
        return;
      }
      savePersistedProjectId(storageKey, normalized);
    },
    [storageKey],
  );

  return {
    projectId,
    setProjectId,
    rememberProjectId,
  };
}
