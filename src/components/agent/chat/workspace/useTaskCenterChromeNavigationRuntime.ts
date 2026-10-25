import { useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Topic } from "../hooks/agentChatShared";
import type { TaskCenterDraftSendRequest } from "../homePendingPreview";
import type { TaskCenterHomeSurfaceState } from "./agentChatWorkspaceHelpers";
import { resolveRecentTopicCandidate } from "../hooks/agentChatShared";
import { useTaskCenterFallbackRestoreRuntime } from "./useTaskCenterFallbackRestoreRuntime";
import { useTaskCenterHomeChromeRuntime } from "./useTaskCenterHomeChromeRuntime";
import {
  resolveTaskCenterVisibleTabIds,
  shouldHideTaskCenterTabsForDetachedSession,
} from "../utils/taskCenterTabs";

interface TaskCenterFallbackRestoreState {
  topicId: string;
  startedAt: number;
}

interface OpenTaskTopicOptions {
  preferResume?: boolean;
  forceRefresh?: boolean;
  replaceOpenTabs?: boolean;
}

interface UseTaskCenterChromeNavigationRuntimeParams {
  agentEntry: "new-task" | "conversation";
  clearEmbeddedHomeSession: (sessionId: string) => void;
  detachedTopicId: string | null;
  draftSendRequest: TaskCenterDraftSendRequest | null;
  draftSurfaceActive: boolean;
  embeddedHomeSessionIds: ReadonlySet<string>;
  fallbackRestoreRef: MutableRefObject<TaskCenterFallbackRestoreState | null>;
  hasDisplayMessages: boolean;
  hasLocalSessionOverride: boolean;
  hasPendingA2UIForm: boolean;
  initialDispatchKey: string | null;
  initialPendingServiceSkillLaunchSignature?: string | null;
  isAutoRestoringSession: boolean;
  isBootstrapDispatchPending: boolean;
  isHomeSessionBackgroundRecovery: boolean;
  isHomePendingPreviewActive: boolean;
  isHomeSendStarting?: boolean;
  isPreparingSend: boolean;
  isSending: boolean;
  isSessionHydrating: boolean;
  isTaskCenterDraftSurfaceActive: boolean;
  messagesLength: number;
  normalizedInitialSessionId?: string | null;
  onOpenTaskTopic: (
    topicId: string,
    options?: OpenTaskTopicOptions,
  ) => void | Promise<void>;
  openTabIds: string[];
  queuedTurnsLength: number;
  sessionId?: string | null;
  setHarnessPanelVisible: Dispatch<SetStateAction<boolean>>;
  shouldSuppressDraftContent: boolean;
  shouldUseBrowserWorkspaceHomeChrome: boolean;
  taskCenterWorkspaceId?: string | null;
  threadItemCount: number;
  topicById: ReadonlyMap<string, Topic>;
  topics: Topic[];
  transitionTopicId: string | null;
  harnessPanelVisible: boolean;
  displayMessageCount: number;
}

interface TaskCenterChromeNavigationRuntime {
  hasHomeConversationActivity: boolean;
  recentSessionTopic: Topic | null;
  isTaskCenterDraftSendPending: boolean;
  shouldRenderTaskCenterEmbeddedHome: boolean;
  suppressHomeNavbarUtilityActions: boolean;
  taskCenterHomeSurfaceState: TaskCenterHomeSurfaceState;
}

export function useTaskCenterChromeNavigationRuntime({
  agentEntry,
  clearEmbeddedHomeSession,
  detachedTopicId,
  displayMessageCount,
  draftSendRequest,
  draftSurfaceActive,
  embeddedHomeSessionIds,
  fallbackRestoreRef,
  hasDisplayMessages,
  hasLocalSessionOverride,
  hasPendingA2UIForm,
  harnessPanelVisible,
  initialDispatchKey,
  initialPendingServiceSkillLaunchSignature,
  isAutoRestoringSession,
  isBootstrapDispatchPending,
  isHomeSessionBackgroundRecovery,
  isHomePendingPreviewActive,
  isHomeSendStarting = false,
  isPreparingSend,
  isSending,
  isSessionHydrating,
  isTaskCenterDraftSurfaceActive,
  messagesLength,
  normalizedInitialSessionId,
  onOpenTaskTopic,
  openTabIds,
  queuedTurnsLength,
  sessionId,
  setHarnessPanelVisible,
  shouldSuppressDraftContent,
  shouldUseBrowserWorkspaceHomeChrome,
  taskCenterWorkspaceId,
  threadItemCount,
  topicById,
  topics,
  transitionTopicId,
}: UseTaskCenterChromeNavigationRuntimeParams): TaskCenterChromeNavigationRuntime {
  const {
    taskCenterPreviewTopicId,
    hasHomeConversationActivity,
    taskCenterHomeSurfaceState,
    isTaskCenterDraftSendPending,
    shouldRenderTaskCenterEmbeddedHome,
    suppressHomeNavbarUtilityActions,
  } = useTaskCenterHomeChromeRuntime({
    agentEntry,
    sessionId,
    detachedTopicId,
    transitionTopicId,
    draftSurfaceActive: isTaskCenterDraftSurfaceActive,
    shouldSuppressDraftContent,
    draftSendRequest,
    normalizedInitialSessionId,
    isHomeSessionBackgroundRecovery,
    displayMessageCount,
    threadItemCount,
    hasPendingA2UIForm,
    isPreparingSend,
    isSending,
    isHomePendingPreviewActive,
    isHomeSendStarting,
    queuedTurnCount: queuedTurnsLength,
    hasLocalSessionOverride,
    embeddedHomeSessionIds,
    isAutoRestoringSession,
    isSessionHydrating,
    shouldUseBrowserWorkspaceHomeChrome,
    harnessPanelVisible,
    setHarnessPanelVisible,
    clearEmbeddedHomeSession,
  });

  const recentSessionTopic = useMemo(
    () => resolveRecentTopicCandidate(topics, sessionId),
    [sessionId, topics],
  );

  const shouldHideDetachedTaskCenterTabs =
    shouldHideTaskCenterTabsForDetachedSession({
      sessionId,
      initialSessionId: normalizedInitialSessionId,
      detachedTopicId,
      openTabIds,
    });
  const taskCenterVisibleTabIds = useMemo(
    () =>
      shouldHideDetachedTaskCenterTabs
        ? []
        : resolveTaskCenterVisibleTabIds({
            openTabIds,
            topics,
            currentTopicId: taskCenterPreviewTopicId,
          }),
    [
      openTabIds,
      topics,
      taskCenterPreviewTopicId,
      shouldHideDetachedTaskCenterTabs,
    ],
  );

  useTaskCenterFallbackRestoreRuntime({
    agentEntry,
    workspaceId: taskCenterWorkspaceId,
    isAutoRestoringSession,
    isSessionHydrating,
    draftSurfaceActive,
    initialPendingServiceSkillLaunchSignature,
    initialDispatchKey,
    isBootstrapDispatchPending,
    isHomeSessionBackgroundRecovery,
    messagesLength,
    isSending,
    queuedTurnsLength,
    shouldHideDetachedTaskCenterTabs,
    normalizedInitialSessionId,
    sessionId,
    currentSessionIsKnownTopic: Boolean(sessionId && topicById.has(sessionId)),
    hasDisplayMessages,
    switchingTopicId: transitionTopicId,
    detachedTopicId,
    openTabIds,
    visibleTabIds: taskCenterVisibleTabIds,
    topics,
    fallbackRestoreRef,
    onOpenTaskTopic,
  });

  return {
    hasHomeConversationActivity,
    recentSessionTopic,
    isTaskCenterDraftSendPending,
    shouldRenderTaskCenterEmbeddedHome,
    suppressHomeNavbarUtilityActions,
    taskCenterHomeSurfaceState,
  };
}
