import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";
import type { Topic } from "../hooks/agentChatShared";
import { loadPersistedSessionWorkspaceId } from "../hooks/agentProjectStorage";
import {
  clearTaskCenterLocalSessionOverrideForTopic,
  clearTaskCenterTransitionTopicForTopic,
  isTaskCenterTopicSwitchSuccess,
  resolveTaskCenterTopicClosePlan,
  resolveTaskCenterTopicSwitchOptions,
  rollbackTaskCenterOpenTabMapForFailedSwitch,
  shouldSkipTaskCenterActiveTopicReopen,
  shouldResumeTaskSession,
  updateTaskCenterTabIdsForWorkspace,
  type TaskCenterWorkspaceTabMap,
} from "../utils/taskCenterTabs";
import { normalizeProjectId } from "../utils/topicProjectResolution";

import type { ComposerDraftNavigationCallbacks } from "./composerDraftNavigation";
import type { WorkspaceTopicSwitchLifecycle } from "./useWorkspaceTopicSwitch";

type AgentEntry = "new-task" | "conversation";

interface TaskCenterTopicSwitchOptions {
  forceRefresh?: boolean;
  resumeSessionStartHooks?: boolean;
  allowDetachedSession?: boolean;
}

interface UseTaskCenterTopicNavigationRuntimeParams extends ComposerDraftNavigationCallbacks {
  activeSessionIdRef: MutableRefObject<string | null>;
  onStartNewConversation?: import("@/lib/workspace/navigation").StartNewConversation;
  agentEntry: AgentEntry;
  clearEntryPendingA2UI: () => void;
  clearTaskCenterEmbeddedHomeSession: (topicId: string) => void;
  messagesLength: number;
  replaceTaskCenterOpenTabs: (
    topicId: string,
    workspaceIdOverride?: string | null,
  ) => void;
  resetLocalImageWorkbenchSessionScope: () => void;
  sessionId?: string | null;
  setTaskCenterDetachedTopicId: Dispatch<SetStateAction<string | null>>;
  setTaskCenterLocalSessionOverride: Dispatch<
    SetStateAction<{ sessionId: string; routeSessionId: string | null } | null>
  >;
  setTaskCenterOpenTabMap: Dispatch<SetStateAction<TaskCenterWorkspaceTabMap>>;
  setTaskCenterTransitionTopicId: Dispatch<SetStateAction<string | null>>;
  switchTopic: (
    topicId: string,
    options?: TaskCenterTopicSwitchOptions,
    lifecycle?: WorkspaceTopicSwitchLifecycle,
  ) => Promise<unknown>;
  taskCenterDetachedTopicId: string | null;
  taskCenterHomeSurfaceActiveRef: MutableRefObject<boolean>;
  taskCenterOpenTabIdsRef: MutableRefObject<string[]>;
  taskCenterTransitionTopicId: string | null;
  taskCenterWorkspaceId?: string | null;
  topicById: ReadonlyMap<string, Topic>;
  upsertTaskCenterOpenTab: (
    topicId: string,
    workspaceIdOverride?: string | null,
  ) => void;
  markTaskCenterLocalSessionOverride: (topicId: string) => void;
}

export function useTaskCenterTopicNavigationRuntime({
  activeSessionIdRef,
  onStartNewConversation,
  agentEntry,
  clearEntryPendingA2UI,
  clearTaskCenterEmbeddedHomeSession,
  messagesLength,
  replaceTaskCenterOpenTabs,
  resetLocalImageWorkbenchSessionScope,
  composerDraftCoordinator,
  getComposerDraftNavigationEpoch,
  sessionId,
  setTaskCenterDetachedTopicId,
  setTaskCenterLocalSessionOverride,
  setTaskCenterOpenTabMap,
  setTaskCenterTransitionTopicId,
  switchTopic,
  taskCenterDetachedTopicId,
  taskCenterHomeSurfaceActiveRef,
  taskCenterOpenTabIdsRef,
  taskCenterTransitionTopicId,
  taskCenterWorkspaceId,
  topicById,
  upsertTaskCenterOpenTab,
  markTaskCenterLocalSessionOverride,
}: UseTaskCenterTopicNavigationRuntimeParams) {
  const navigationVersionRef = useRef(0);
  const handleOpenTaskTopic = useCallback(
    async (
      topicId: string,
      options?: {
        preferResume?: boolean;
        forceRefresh?: boolean;
        replaceOpenTabs?: boolean;
      },
    ) => {
      const topic = topicById.get(topicId);
      const topicWorkspaceId = normalizeProjectId(
        topic?.workspaceId ?? loadPersistedSessionWorkspaceId(topicId),
      );
      const isDetachedTopic = !topicWorkspaceId;
      const shouldResume =
        options?.preferResume === true || shouldResumeTaskSession(topic);
      const switchOptions = resolveTaskCenterTopicSwitchOptions({
        shouldResume,
        forceRefresh: options?.forceRefresh,
        allowDetachedSession: isDetachedTopic,
      });
      const wasOpenInTaskCenter =
        taskCenterOpenTabIdsRef.current.includes(topicId);
      const shouldMaintainTaskCenterTab =
        agentEntry === "conversation" || agentEntry === "new-task";
      const shouldSkipActiveTopicReopen = shouldSkipTaskCenterActiveTopicReopen(
        {
          topicId,
          activeSessionId: activeSessionIdRef.current,
          messagesLength,
          draftSurfaceActive: taskCenterHomeSurfaceActiveRef.current,
          detachedTopicId: taskCenterDetachedTopicId,
          shouldResume,
          forceRefresh: options?.forceRefresh,
          preferResume: options?.preferResume,
          replaceOpenTabs: options?.replaceOpenTabs,
        },
      );
      const rollbackPendingOpen = () => {
        setTaskCenterOpenTabMap((currentMap) =>
          rollbackTaskCenterOpenTabMapForFailedSwitch({
            currentMap,
            workspaceId: topicWorkspaceId,
            topicId,
            wasOpenInTaskCenter,
            replaceOpenTabs: options?.replaceOpenTabs,
          }),
        );
        setTaskCenterLocalSessionOverride((current) =>
          clearTaskCenterLocalSessionOverrideForTopic(current, topicId),
        );
        setTaskCenterTransitionTopicId((current) =>
          clearTaskCenterTransitionTopicForTopic(current, topicId),
        );
      };

      if (shouldSkipActiveTopicReopen) {
        return;
      }

      const navigationVersion = ++navigationVersionRef.current;
      const sourceNavigationEpoch = getComposerDraftNavigationEpoch?.();
      const isNavigationCurrent = () =>
        navigationVersion === navigationVersionRef.current &&
        sourceNavigationEpoch === getComposerDraftNavigationEpoch?.();
      composerDraftCoordinator?.prepareNavigation();
      let activationCommitted = false;
      const commitTopicActivation = () => {
        if (activationCommitted || !isNavigationCurrent()) return;
        activationCommitted = true;
        taskCenterHomeSurfaceActiveRef.current = false;
        clearTaskCenterEmbeddedHomeSession(topicId);
        resetLocalImageWorkbenchSessionScope();
        clearEntryPendingA2UI();
      };
      const lifecycle = { onHydrated: commitTopicActivation };
      setTaskCenterTransitionTopicId(topicId);
      setTaskCenterDetachedTopicId(isDetachedTopic ? topicId : null);
      if (options?.replaceOpenTabs === true) {
        replaceTaskCenterOpenTabs(topicId, topicWorkspaceId);
      } else if (shouldMaintainTaskCenterTab) {
        upsertTaskCenterOpenTab(topicId, topicWorkspaceId);
      }
      markTaskCenterLocalSessionOverride(topicId);
      let switchResult: unknown;
      try {
        switchResult = await switchTopic(topicId, switchOptions, lifecycle);
      } catch (error) {
        if (isNavigationCurrent()) rollbackPendingOpen();
        throw error;
      }
      if (switchResult === "busy") {
        scheduleMinimumDelayIdleTask(
          () => {
            if (!isNavigationCurrent()) return;
            void switchTopic(topicId, switchOptions, lifecycle)
              .then((retryResult) => {
                if (!isNavigationCurrent()) return;
                if (!isTaskCenterTopicSwitchSuccess(retryResult)) {
                  rollbackPendingOpen();
                } else if (retryResult !== "deferred") {
                  commitTopicActivation();
                }
              })
              .catch(() => {
                if (isNavigationCurrent()) rollbackPendingOpen();
              });
          },
          {
            minimumDelayMs: 120,
            idleTimeoutMs: 600,
          },
        );
        return switchResult;
      }
      if (!isNavigationCurrent())
        return activationCommitted &&
          isTaskCenterTopicSwitchSuccess(switchResult)
          ? switchResult
          : "superseded";
      if (!isTaskCenterTopicSwitchSuccess(switchResult)) {
        rollbackPendingOpen();
        return switchResult;
      }
      if (switchResult !== "deferred") {
        commitTopicActivation();
      }
      if (options?.replaceOpenTabs === true) {
        replaceTaskCenterOpenTabs(topicId, topicWorkspaceId);
      } else if (shouldMaintainTaskCenterTab) {
        upsertTaskCenterOpenTab(topicId, topicWorkspaceId);
      }
      return switchResult;
    },
    [
      activeSessionIdRef,
      agentEntry,
      clearEntryPendingA2UI,
      composerDraftCoordinator,
      getComposerDraftNavigationEpoch,
      clearTaskCenterEmbeddedHomeSession,
      markTaskCenterLocalSessionOverride,
      messagesLength,
      replaceTaskCenterOpenTabs,
      resetLocalImageWorkbenchSessionScope,
      setTaskCenterDetachedTopicId,
      setTaskCenterLocalSessionOverride,
      setTaskCenterOpenTabMap,
      setTaskCenterTransitionTopicId,
      switchTopic,
      taskCenterDetachedTopicId,
      taskCenterHomeSurfaceActiveRef,
      taskCenterOpenTabIdsRef,
      topicById,
      upsertTaskCenterOpenTab,
    ],
  );

  const handleSwitchTaskTopic = handleOpenTaskTopic;

  const handleCloseTaskCenterTab = useCallback(
    async (topicId: string) => {
      const closePlan = resolveTaskCenterTopicClosePlan({
        closingTopicId: topicId,
        currentOpenTabIds: taskCenterOpenTabIdsRef.current,
        sessionId,
        detachedTopicId: taskCenterDetachedTopicId,
        transitionTopicId: taskCenterTransitionTopicId,
      });

      if (closePlan.shouldClearDetachedTopic) {
        setTaskCenterDetachedTopicId(null);
      }
      if (closePlan.shouldClearTransitionTopic) {
        setTaskCenterTransitionTopicId(null);
      }
      clearTaskCenterEmbeddedHomeSession(topicId);

      setTaskCenterOpenTabMap((currentMap) =>
        updateTaskCenterTabIdsForWorkspace(
          currentMap,
          taskCenterWorkspaceId,
          closePlan.remainingIds,
        ),
      );

      if (closePlan.isActiveTab) {
        if (closePlan.fallbackTopicId) {
          await handleSwitchTaskTopic(closePlan.fallbackTopicId);
        } else {
          onStartNewConversation?.({
            projectId: normalizeProjectId(taskCenterWorkspaceId),
            freshDraft: false,
          });
        }
      }
    },
    [
      clearTaskCenterEmbeddedHomeSession,
      handleSwitchTaskTopic,
      sessionId,
      onStartNewConversation,
      setTaskCenterDetachedTopicId,
      setTaskCenterOpenTabMap,
      setTaskCenterTransitionTopicId,
      taskCenterDetachedTopicId,
      taskCenterOpenTabIdsRef,
      taskCenterTransitionTopicId,
      taskCenterWorkspaceId,
    ],
  );

  return {
    handleCloseTaskCenterTab,
    handleOpenTaskTopic,
    handleSwitchTaskTopic,
  };
}
