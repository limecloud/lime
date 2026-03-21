import { useCallback, useRef, useState } from "react";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import {
  LAST_PROJECT_ID_KEY,
  loadPersistedProjectId,
  savePersistedProjectId,
} from "./agentProjectStorage";

interface PendingTopicSwitchState {
  topicId: string;
  targetProjectId: string;
}

interface UseWorkspaceProjectSelectionOptions {
  externalProjectId?: string | null;
  newChatAt?: number;
  storageKey?: string;
}

export function useWorkspaceProjectSelection(
  options: UseWorkspaceProjectSelectionOptions = {},
) {
  const {
    externalProjectId,
    newChatAt,
    storageKey = LAST_PROJECT_ID_KEY,
  } = options;
  const normalizedExternalProjectId = normalizeProjectId(externalProjectId);
  const [internalProjectId, setInternalProjectId] = useState<string | null>(
    null,
  );
  const handledNewChatRequestRef = useRef<string | null>(null);
  const pendingTopicSwitchRef = useRef<PendingTopicSwitchState | null>(null);
  const isResolvingTopicProjectRef = useRef(false);

  const incomingNewChatRequestKey =
    typeof newChatAt === "number" ? String(newChatAt) : null;
  const shouldDisableSessionRestore = incomingNewChatRequestKey !== null;
  const shouldResetToFreshHomeContext =
    !normalizedExternalProjectId &&
    incomingNewChatRequestKey !== null &&
    handledNewChatRequestRef.current !== incomingNewChatRequestKey;

  const projectId =
    normalizedExternalProjectId ??
    (shouldResetToFreshHomeContext ? undefined : internalProjectId) ??
    undefined;

  const hasHandledNewChatRequest = useCallback(
    (requestKey: string) => handledNewChatRequestRef.current === requestKey,
    [],
  );

  const markNewChatRequestHandled = useCallback((requestKey: string) => {
    handledNewChatRequestRef.current = requestKey;
  }, []);

  const clearProjectSelectionRuntime = useCallback(() => {
    pendingTopicSwitchRef.current = null;
    isResolvingTopicProjectRef.current = false;
  }, []);

  const rememberProjectId = useCallback(
    (nextProjectId?: string | null) => {
      const normalizedProjectId = normalizeProjectId(nextProjectId);
      if (!normalizedProjectId) {
        return;
      }

      savePersistedProjectId(storageKey, normalizedProjectId);
    },
    [storageKey],
  );

  const resetProjectSelection = useCallback(() => {
    clearProjectSelectionRuntime();
    setInternalProjectId(null);
  }, [clearProjectSelectionRuntime]);

  const applyProjectSelection = useCallback(
    (nextProjectId?: string | null) => {
      if (normalizedExternalProjectId) {
        return;
      }

      const normalizedProjectId = normalizeProjectId(nextProjectId);
      clearProjectSelectionRuntime();
      rememberProjectId(normalizedProjectId);
      setInternalProjectId(normalizedProjectId);
    },
    [clearProjectSelectionRuntime, normalizedExternalProjectId, rememberProjectId],
  );

  const startTopicProjectResolution = useCallback(() => {
    if (isResolvingTopicProjectRef.current) {
      return false;
    }

    isResolvingTopicProjectRef.current = true;
    return true;
  }, []);

  const finishTopicProjectResolution = useCallback(() => {
    isResolvingTopicProjectRef.current = false;
  }, []);

  const deferTopicSwitch = useCallback(
    (topicId: string, targetProjectId: string) => {
      const normalizedTargetProjectId = normalizeProjectId(targetProjectId);
      if (!normalizedTargetProjectId) {
        pendingTopicSwitchRef.current = null;
        return;
      }

      rememberProjectId(normalizedTargetProjectId);
      pendingTopicSwitchRef.current = {
        topicId,
        targetProjectId: normalizedTargetProjectId,
      };
      setInternalProjectId(normalizedTargetProjectId);
    },
    [rememberProjectId],
  );

  const consumePendingTopicSwitch = useCallback(
    (currentProjectId?: string | null) => {
      const pending = pendingTopicSwitchRef.current;
      if (!pending) {
        return null;
      }

      const normalizedCurrentProjectId = normalizeProjectId(currentProjectId);
      if (normalizedCurrentProjectId !== pending.targetProjectId) {
        return null;
      }

      pendingTopicSwitchRef.current = null;
      return pending;
    },
    [],
  );

  const getRememberedProjectId = useCallback(
    () => loadPersistedProjectId(storageKey),
    [storageKey],
  );

  return {
    projectId,
    shouldDisableSessionRestore,
    hasHandledNewChatRequest,
    markNewChatRequestHandled,
    rememberProjectId,
    getRememberedProjectId,
    applyProjectSelection,
    resetProjectSelection,
    clearProjectSelectionRuntime,
    startTopicProjectResolution,
    finishTopicProjectResolution,
    deferTopicSwitch,
    consumePendingTopicSwitch,
  };
}
