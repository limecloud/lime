import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Topic } from "../hooks/agentChatShared";
import { loadPersisted, savePersisted } from "../hooks/agentChatStorage";
import type { TaskCenterDraftSendRequest } from "../homePendingPreview";
import {
  applyTaskCenterRouteTabSyncToMap,
  initializeTaskCenterOpenTabMap,
  isTaskCenterAgentEntry,
  MAX_TASK_CENTER_OPEN_TABS,
  normalizeTaskCenterWorkspaceTabMap,
  reconcileTaskCenterTabIds,
  replaceTaskCenterTabIdsForWorkspace,
  resolveTaskCenterReconcileCurrentTopicId,
  resolveTaskCenterRouteTabSyncIntent,
  resolveTaskCenterTabIdsForWorkspace,
  shouldRespectTaskCenterLocalSessionOverride,
  shouldWaitForTaskCenterInitialSessionTopic,
  TASK_CENTER_OPEN_TAB_IDS_STORAGE_KEY,
  updateTaskCenterTabIdsForWorkspace,
  type TaskCenterLocalSessionOverride,
  type TaskCenterWorkspaceTabMap,
} from "../utils/taskCenterTabs";
import type { AgentChatWorkspaceProps } from "../agentChatWorkspaceContract";
import { normalizeProjectId } from "../utils/topicProjectResolution";

type AgentEntry = AgentChatWorkspaceProps["agentEntry"] | null;

function resolveTaskCenterTabWorkspaceId(
  workspaceIdOverride: string | null | undefined,
  fallbackWorkspaceId: string | null | undefined,
): string | null {
  return normalizeProjectId(workspaceIdOverride) ?? fallbackWorkspaceId ?? null;
}

interface UseTaskCenterTabSessionRuntimeParams {
  agentEntry?: AgentEntry;
  normalizedInitialSessionId?: string | null;
  newChatAt?: number;
  sessionId?: string | null;
  taskCenterHomeSurfaceActiveRef: MutableRefObject<boolean>;
  taskCenterWorkspaceId?: string | null;
  topicById: ReadonlyMap<string, Topic>;
  topics: Topic[];
  setHomePendingPreviewRequest: Dispatch<
    SetStateAction<TaskCenterDraftSendRequest | null>
  >;
  setTaskCenterDraftSendRequest: Dispatch<
    SetStateAction<TaskCenterDraftSendRequest | null>
  >;
}

export interface TaskCenterTabSessionRuntimeState {
  clearTaskCenterEmbeddedHomeSession: (topicId: string) => void;
  isTaskCenterEntry: boolean;
  markTaskCenterEmbeddedHomeSession: (topicId: string) => void;
  markTaskCenterLocalSessionOverride: (topicId: string) => void;
  replaceTaskCenterOpenTabs: (
    topicId: string,
    workspaceIdOverride?: string | null,
  ) => void;
  setTaskCenterDetachedTopicId: Dispatch<SetStateAction<string | null>>;
  setTaskCenterLocalSessionOverride: Dispatch<
    SetStateAction<TaskCenterLocalSessionOverride | null>
  >;
  setTaskCenterOpenTabMap: Dispatch<SetStateAction<TaskCenterWorkspaceTabMap>>;
  setTaskCenterTransitionTopicId: Dispatch<SetStateAction<string | null>>;
  taskCenterDetachedTopicId: string | null;
  taskCenterEmbeddedHomeSessionIds: Set<string>;
  taskCenterFallbackRestoreRef: MutableRefObject<{
    topicId: string;
    startedAt: number;
  } | null>;
  taskCenterLocalSessionOverride: TaskCenterLocalSessionOverride | null;
  taskCenterOpenTabIds: string[];
  taskCenterOpenTabIdsRef: MutableRefObject<string[]>;
  taskCenterTransitionTopicId: string | null;
  upsertTaskCenterOpenTab: (
    topicId: string,
    workspaceIdOverride?: string | null,
  ) => void;
}

export function useTaskCenterTabSessionRuntime({
  agentEntry,
  normalizedInitialSessionId,
  newChatAt,
  sessionId,
  taskCenterHomeSurfaceActiveRef,
  taskCenterWorkspaceId,
  topicById,
  topics,
  setHomePendingPreviewRequest,
  setTaskCenterDraftSendRequest,
}: UseTaskCenterTabSessionRuntimeParams): TaskCenterTabSessionRuntimeState {
  const shouldStartNewTaskHome =
    agentEntry === "new-task" &&
    !normalizedInitialSessionId &&
    typeof newChatAt === "number";
  const [taskCenterOpenTabMap, setTaskCenterOpenTabMap] =
    useState<TaskCenterWorkspaceTabMap>(() => {
      const initialTabMap = normalizeTaskCenterWorkspaceTabMap(
        loadPersisted<unknown>(TASK_CENTER_OPEN_TAB_IDS_STORAGE_KEY, []),
        {
          workspaceId: taskCenterWorkspaceId,
        },
      );
      if (shouldStartNewTaskHome) {
        return updateTaskCenterTabIdsForWorkspace(
          initialTabMap,
          taskCenterWorkspaceId,
          [],
        );
      }

      return initializeTaskCenterOpenTabMap({
        initialTabMap,
        agentEntry,
        workspaceId: taskCenterWorkspaceId,
        normalizedInitialSessionId,
      });
    });
  const [taskCenterDetachedTopicId, setTaskCenterDetachedTopicId] = useState<
    string | null
  >(null);
  const [taskCenterTransitionTopicId, setTaskCenterTransitionTopicId] =
    useState<string | null>(null);
  const [
    taskCenterEmbeddedHomeSessionIds,
    setTaskCenterEmbeddedHomeSessionIds,
  ] = useState<Set<string>>(() => new Set());
  const [taskCenterLocalSessionOverride, setTaskCenterLocalSessionOverride] =
    useState<TaskCenterLocalSessionOverride | null>(null);
  const taskCenterOpenTabIds = useMemo(
    () =>
      resolveTaskCenterTabIdsForWorkspace(
        taskCenterOpenTabMap,
        taskCenterWorkspaceId,
      ),
    [taskCenterOpenTabMap, taskCenterWorkspaceId],
  );
  const taskCenterOpenTabIdsRef = useRef(taskCenterOpenTabIds);
  const taskCenterFallbackRestoreRef = useRef<{
    topicId: string;
    startedAt: number;
  } | null>(null);
  const taskCenterRouteTabSyncRef = useRef<string | null>(null);
  const taskCenterNewChatResetRef = useRef<string | null>(
    shouldStartNewTaskHome ? String(newChatAt) : null,
  );
  const isTaskCenterEntry = isTaskCenterAgentEntry(agentEntry);
  const shouldRespectTaskCenterLocalSession =
    shouldRespectTaskCenterLocalSessionOverride({
      localSessionOverride: taskCenterLocalSessionOverride,
      normalizedInitialSessionId,
      sessionId,
    });

  useEffect(() => {
    taskCenterOpenTabIdsRef.current = taskCenterOpenTabIds;
  }, [taskCenterOpenTabIds]);

  useEffect(() => {
    const requestKey =
      agentEntry === "new-task" &&
      !normalizedInitialSessionId &&
      typeof newChatAt === "number"
        ? String(newChatAt)
        : null;
    if (!requestKey || taskCenterNewChatResetRef.current === requestKey) {
      return;
    }

    taskCenterNewChatResetRef.current = requestKey;
    taskCenterFallbackRestoreRef.current = null;
    taskCenterHomeSurfaceActiveRef.current = true;
    setTaskCenterDetachedTopicId(null);
    setTaskCenterTransitionTopicId(null);
    setTaskCenterEmbeddedHomeSessionIds((current) =>
      current.size > 0 ? new Set<string>() : current,
    );
    setTaskCenterLocalSessionOverride(null);
    setTaskCenterDraftSendRequest(null);
    setHomePendingPreviewRequest(null);
    setTaskCenterOpenTabMap((currentMap) =>
      updateTaskCenterTabIdsForWorkspace(currentMap, taskCenterWorkspaceId, []),
    );
  }, [
    agentEntry,
    newChatAt,
    normalizedInitialSessionId,
    setHomePendingPreviewRequest,
    setTaskCenterDraftSendRequest,
    taskCenterHomeSurfaceActiveRef,
    taskCenterWorkspaceId,
  ]);

  useEffect(() => {
    if (!isTaskCenterEntry) {
      taskCenterHomeSurfaceActiveRef.current = false;
      setTaskCenterTransitionTopicId(null);
      return;
    }

    if (
      taskCenterTransitionTopicId &&
      taskCenterTransitionTopicId === sessionId
    ) {
      setTaskCenterTransitionTopicId(null);
    }
  }, [
    isTaskCenterEntry,
    sessionId,
    taskCenterHomeSurfaceActiveRef,
    taskCenterTransitionTopicId,
  ]);

  useEffect(() => {
    if (!isTaskCenterEntry) {
      setTaskCenterDetachedTopicId(null);
      setTaskCenterEmbeddedHomeSessionIds((current) =>
        current.size > 0 ? new Set<string>() : current,
      );
      taskCenterHomeSurfaceActiveRef.current = false;
      if (agentEntry !== "new-task") {
        setTaskCenterDraftSendRequest(null);
        setHomePendingPreviewRequest(null);
        setTaskCenterLocalSessionOverride(null);
      }
      return;
    }

    if (!sessionId || sessionId !== normalizedInitialSessionId) {
      return;
    }

    const hasTopicMatch = topicById.has(sessionId);
    if (hasTopicMatch) {
      setTaskCenterDetachedTopicId((current) =>
        current === sessionId ? null : current,
      );
      return;
    }

    setTaskCenterDetachedTopicId((current) =>
      current === sessionId ? current : sessionId,
    );
  }, [
    agentEntry,
    isTaskCenterEntry,
    normalizedInitialSessionId,
    sessionId,
    setHomePendingPreviewRequest,
    setTaskCenterDraftSendRequest,
    taskCenterHomeSurfaceActiveRef,
    topicById,
  ]);

  useEffect(() => {
    const syncIntent = resolveTaskCenterRouteTabSyncIntent({
      agentEntry,
      workspaceId: taskCenterWorkspaceId,
      normalizedInitialSessionId,
      lastSyncedInitialSessionId: taskCenterRouteTabSyncRef.current,
      shouldRespectLocalSession: shouldRespectTaskCenterLocalSession,
    });
    if (!syncIntent.shouldSync) {
      return;
    }

    taskCenterRouteTabSyncRef.current = syncIntent.nextRouteSyncSessionId;
    if (syncIntent.shouldClearTransitionAndDetached) {
      setTaskCenterTransitionTopicId(null);
      setTaskCenterDetachedTopicId(null);
    }
    setTaskCenterOpenTabMap((currentMap) =>
      applyTaskCenterRouteTabSyncToMap({
        currentMap,
        workspaceId: taskCenterWorkspaceId,
        normalizedInitialSessionId,
        shouldRespectLocalSession: shouldRespectTaskCenterLocalSession,
      }),
    );
  }, [
    agentEntry,
    normalizedInitialSessionId,
    shouldRespectTaskCenterLocalSession,
    taskCenterWorkspaceId,
  ]);

  useEffect(() => {
    if (
      !isTaskCenterEntry ||
      !taskCenterWorkspaceId ||
      !normalizedInitialSessionId ||
      normalizedInitialSessionId === sessionId ||
      shouldRespectTaskCenterLocalSession
    ) {
      return;
    }

    setTaskCenterTransitionTopicId((current) =>
      current === normalizedInitialSessionId
        ? current
        : normalizedInitialSessionId,
    );
    setTaskCenterDetachedTopicId(null);
  }, [
    isTaskCenterEntry,
    normalizedInitialSessionId,
    sessionId,
    shouldRespectTaskCenterLocalSession,
    taskCenterWorkspaceId,
  ]);

  useEffect(() => {
    if (!isTaskCenterEntry || !taskCenterWorkspaceId) {
      return;
    }
    if (shouldStartNewTaskHome) {
      return;
    }

    const hasInitialSessionTopic = normalizedInitialSessionId
      ? topicById.has(normalizedInitialSessionId)
      : false;
    if (
      shouldWaitForTaskCenterInitialSessionTopic({
        normalizedInitialSessionId,
        hasInitialSessionTopic,
      })
    ) {
      return;
    }

    setTaskCenterOpenTabMap((currentMap) => {
      const nextIds = reconcileTaskCenterTabIds({
        existingIds: resolveTaskCenterTabIdsForWorkspace(
          currentMap,
          taskCenterWorkspaceId,
        ),
        topics,
        currentTopicId: resolveTaskCenterReconcileCurrentTopicId({
          normalizedInitialSessionId,
          sessionId,
          shouldRespectLocalSession: shouldRespectTaskCenterLocalSession,
          localSessionOverride: taskCenterLocalSessionOverride,
          detachedTopicId: taskCenterDetachedTopicId,
        }),
      });
      return updateTaskCenterTabIdsForWorkspace(
        currentMap,
        taskCenterWorkspaceId,
        nextIds,
      );
    });
  }, [
    isTaskCenterEntry,
    normalizedInitialSessionId,
    sessionId,
    shouldRespectTaskCenterLocalSession,
    shouldStartNewTaskHome,
    taskCenterDetachedTopicId,
    taskCenterLocalSessionOverride,
    taskCenterWorkspaceId,
    topicById,
    topics,
  ]);

  useEffect(() => {
    if (agentEntry !== "conversation" && agentEntry !== "new-task") {
      return;
    }

    savePersisted(TASK_CENTER_OPEN_TAB_IDS_STORAGE_KEY, taskCenterOpenTabMap);
  }, [agentEntry, taskCenterOpenTabMap]);

  const upsertTaskCenterOpenTab = useCallback(
    (topicId: string, workspaceIdOverride?: string | null) => {
      const targetWorkspaceId = resolveTaskCenterTabWorkspaceId(
        workspaceIdOverride,
        taskCenterWorkspaceId,
      );
      if (!targetWorkspaceId) {
        return;
      }

      setTaskCenterOpenTabMap((currentMap) =>
        updateTaskCenterTabIdsForWorkspace(
          currentMap,
          targetWorkspaceId,
          (currentIds) =>
            [topicId, ...currentIds.filter((item) => item !== topicId)].slice(
              0,
              MAX_TASK_CENTER_OPEN_TABS,
            ),
        ),
      );
    },
    [taskCenterWorkspaceId],
  );

  const replaceTaskCenterOpenTabs = useCallback(
    (topicId: string, workspaceIdOverride?: string | null) => {
      const targetWorkspaceId = resolveTaskCenterTabWorkspaceId(
        workspaceIdOverride,
        taskCenterWorkspaceId,
      );
      if (!targetWorkspaceId) {
        return;
      }

      setTaskCenterOpenTabMap((currentMap) =>
        replaceTaskCenterTabIdsForWorkspace(
          currentMap,
          targetWorkspaceId,
          topicId,
        ),
      );
    },
    [taskCenterWorkspaceId],
  );

  const markTaskCenterEmbeddedHomeSession = useCallback((topicId: string) => {
    setTaskCenterEmbeddedHomeSessionIds((current) => {
      if (current.has(topicId)) {
        return current;
      }

      const next = new Set(current);
      next.add(topicId);
      return next;
    });
  }, []);

  const markTaskCenterLocalSessionOverride = useCallback(
    (topicId: string) => {
      setTaskCenterLocalSessionOverride({
        sessionId: topicId,
        routeSessionId: normalizedInitialSessionId ?? null,
      });
    },
    [normalizedInitialSessionId],
  );

  const clearTaskCenterEmbeddedHomeSession = useCallback((topicId: string) => {
    setTaskCenterEmbeddedHomeSessionIds((current) => {
      if (!current.has(topicId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(topicId);
      return next;
    });
  }, []);

  return {
    clearTaskCenterEmbeddedHomeSession,
    isTaskCenterEntry,
    markTaskCenterEmbeddedHomeSession,
    markTaskCenterLocalSessionOverride,
    replaceTaskCenterOpenTabs,
    setTaskCenterDetachedTopicId,
    setTaskCenterLocalSessionOverride,
    setTaskCenterOpenTabMap,
    setTaskCenterTransitionTopicId,
    taskCenterDetachedTopicId,
    taskCenterEmbeddedHomeSessionIds,
    taskCenterFallbackRestoreRef,
    taskCenterLocalSessionOverride,
    taskCenterOpenTabIds,
    taskCenterOpenTabIdsRef,
    taskCenterTransitionTopicId,
    upsertTaskCenterOpenTab,
  };
}
