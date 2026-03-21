import { useCallback, useEffect, useState } from "react";
import { normalizeProjectId } from "../utils/topicProjectResolution";

export const LAST_PROJECT_ID_KEY = "agent_last_project_id";

export function loadPersistedProjectId(key: string): string | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored);
      return normalizeProjectId(typeof parsed === "string" ? parsed : stored);
    } catch {
      return normalizeProjectId(stored);
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
