import { useEffect, type MutableRefObject } from "react";
import { logAgentDebug } from "@/lib/agentDebug";
import type { Topic } from "../hooks/agentChatShared";
import { resolveTaskCenterFallbackRestorePlan } from "../utils/taskCenterTabs";

interface TaskCenterFallbackRestoreState {
  topicId: string;
  startedAt: number;
}

interface UseTaskCenterFallbackRestoreRuntimeParams {
  agentEntry: string;
  workspaceId?: string | null;
  isAutoRestoringSession: boolean;
  isSessionHydrating: boolean;
  draftSurfaceActive: boolean;
  initialPendingServiceSkillLaunchSignature?: string | null;
  initialDispatchKey?: string | null;
  isBootstrapDispatchPending: boolean;
  isHomeSessionBackgroundRecovery: boolean;
  messagesLength: number;
  isSending: boolean;
  queuedTurnsLength: number;
  shouldHideDetachedTaskCenterTabs: boolean;
  normalizedInitialSessionId?: string | null;
  sessionId?: string | null;
  currentSessionIsKnownTopic: boolean;
  hasDisplayMessages: boolean;
  switchingTopicId?: string | null;
  detachedTopicId?: string | null;
  openTabIds: string[];
  visibleTabIds: string[];
  topics: Pick<Topic, "id">[];
  fallbackRestoreRef: MutableRefObject<TaskCenterFallbackRestoreState | null>;
  onOpenTaskTopic: (topicId: string) => void | Promise<void>;
}

export function useTaskCenterFallbackRestoreRuntime({
  agentEntry,
  workspaceId,
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
  currentSessionIsKnownTopic,
  hasDisplayMessages,
  switchingTopicId,
  detachedTopicId,
  openTabIds,
  visibleTabIds,
  topics,
  fallbackRestoreRef,
  onOpenTaskTopic,
}: UseTaskCenterFallbackRestoreRuntimeParams): void {
  useEffect(() => {
    const restorePlan = resolveTaskCenterFallbackRestorePlan({
      agentEntry,
      workspaceId,
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
      currentSessionIsKnownTopic,
      hasDisplayMessages,
      switchingTopicId,
      openTabIds,
      topics,
      previousRestore: fallbackRestoreRef.current,
      now: Date.now(),
    });

    if (restorePlan.action === "skip") {
      if (restorePlan.reason !== "detached-session") {
        return;
      }
      logAgentDebug(
        "LocalConversationPage",
        "taskCenter.fallback.skipDetachedSession",
        {
          detachedTopicId,
          initialSessionId: normalizedInitialSessionId,
          openTabIds,
          sessionId,
          visibleTabIds,
        },
        {
          dedupeKey: `taskCenter.fallback.skipDetached:${sessionId ?? "none"}:${detachedTopicId ?? "none"}`,
          throttleMs: 1000,
        },
      );
      return;
    }

    fallbackRestoreRef.current = restorePlan.nextRestore;
    logAgentDebug("LocalConversationPage", "taskCenter.fallback.restoreVisibleTask", {
      fallbackId: restorePlan.fallbackTopicId,
      openTabIds,
      sessionId,
      transitionTopicId: switchingTopicId,
      visibleTabIds,
    });

    void onOpenTaskTopic(restorePlan.fallbackTopicId);
  }, [
    agentEntry,
    currentSessionIsKnownTopic,
    detachedTopicId,
    draftSurfaceActive,
    fallbackRestoreRef,
    hasDisplayMessages,
    initialDispatchKey,
    initialPendingServiceSkillLaunchSignature,
    isAutoRestoringSession,
    isBootstrapDispatchPending,
    isHomeSessionBackgroundRecovery,
    isSending,
    isSessionHydrating,
    messagesLength,
    normalizedInitialSessionId,
    onOpenTaskTopic,
    openTabIds,
    queuedTurnsLength,
    sessionId,
    shouldHideDetachedTaskCenterTabs,
    switchingTopicId,
    topics,
    visibleTabIds,
    workspaceId,
  ]);
}
