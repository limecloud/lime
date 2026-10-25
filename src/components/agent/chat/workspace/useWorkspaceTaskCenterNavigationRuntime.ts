import { useCallback } from "react";
import {
  loadPersistedProjectId,
  loadPersistedSessionWorkspaceId,
} from "../hooks/agentProjectStorage";
import { resolveInitialTaskSessionSwitchOptions } from "../utils/taskCenterTabs";
import { useTaskCenterTabSessionRuntime } from "./useTaskCenterTabSessionRuntime";
import { useWorkspaceInitialSessionNavigation } from "./useWorkspaceInitialSessionNavigation";
import { useWorkspaceTopicSwitch } from "./useWorkspaceTopicSwitch";

type TopicSwitchParams = Parameters<typeof useWorkspaceTopicSwitch>[0];
type InitialSessionNavigationParams = Parameters<
  typeof useWorkspaceInitialSessionNavigation
>[0];
type TabSessionParams = Parameters<typeof useTaskCenterTabSessionRuntime>[0];

interface UseWorkspaceTaskCenterNavigationRuntimeParams {
  agentEntry: TabSessionParams["agentEntry"];
  consumePendingTopicSwitch: TopicSwitchParams["consumePendingTopicSwitch"];
  currentSessionId: InitialSessionNavigationParams["currentSessionId"];
  deferTopicSwitch: TopicSwitchParams["deferTopicSwitch"];
  externalProjectId: TopicSwitchParams["externalProjectId"];
  finishTopicProjectResolution: TopicSwitchParams["finishTopicProjectResolution"];
  getRememberedProjectId: TopicSwitchParams["getRememberedProjectId"];
  initialSessionId: InitialSessionNavigationParams["initialSessionId"];
  isAutoRestoringSession: boolean;
  isSessionHydrating: boolean;
  messagesLength: number;
  newChatAt: TabSessionParams["newChatAt"];
  normalizedInitialSessionId: TabSessionParams["normalizedInitialSessionId"];
  onBeforeTopicSwitch: TopicSwitchParams["onBeforeTopicSwitch"];
  onAfterTopicSwitch?: TopicSwitchParams["onAfterTopicSwitch"];
  composerDraftCoordinator?: TopicSwitchParams["composerDraftCoordinator"];
  getComposerDraftNavigationEpoch?: TopicSwitchParams["getComposerDraftNavigationEpoch"];
  originalSwitchTopic: TopicSwitchParams["originalSwitchTopic"];
  projectId: TopicSwitchParams["projectId"];
  rememberProjectId: TopicSwitchParams["rememberProjectId"];
  resetTopicLocalState: TopicSwitchParams["resetTopicLocalState"];
  setHomePendingPreviewRequest: TabSessionParams["setHomePendingPreviewRequest"];
  setTaskCenterDraftSendRequest: TabSessionParams["setTaskCenterDraftSendRequest"];
  shouldHydrateEmptyMatchedInitialSession: boolean;
  shouldPauseInitialSessionNavigationForTaskCenterDraft: boolean;
  startTopicProjectResolution: TopicSwitchParams["startTopicProjectResolution"];
  taskCenterHomeSurfaceActiveRef: TabSessionParams["taskCenterHomeSurfaceActiveRef"];
  taskCenterWorkspaceId: TabSessionParams["taskCenterWorkspaceId"];
  threadItemsLength: number;
  topicById: TabSessionParams["topicById"];
  topics: TabSessionParams["topics"];
  turnsLength: number;
}

/** Task Center 的 topic switch、首会话恢复和 tab session 只在此处组合。 */
export function useWorkspaceTaskCenterNavigationRuntime({
  agentEntry,
  consumePendingTopicSwitch,
  currentSessionId,
  deferTopicSwitch,
  externalProjectId,
  finishTopicProjectResolution,
  getRememberedProjectId,
  initialSessionId,
  isAutoRestoringSession,
  isSessionHydrating,
  messagesLength,
  newChatAt,
  normalizedInitialSessionId,
  onBeforeTopicSwitch,
  onAfterTopicSwitch,
  composerDraftCoordinator,
  getComposerDraftNavigationEpoch,
  originalSwitchTopic,
  projectId,
  rememberProjectId,
  resetTopicLocalState,
  setHomePendingPreviewRequest,
  setTaskCenterDraftSendRequest,
  shouldHydrateEmptyMatchedInitialSession,
  shouldPauseInitialSessionNavigationForTaskCenterDraft,
  startTopicProjectResolution,
  taskCenterHomeSurfaceActiveRef,
  taskCenterWorkspaceId,
  threadItemsLength,
  topicById,
  topics,
  turnsLength,
}: UseWorkspaceTaskCenterNavigationRuntimeParams) {
  const topicSwitchRuntime = useWorkspaceTopicSwitch({
    projectId,
    externalProjectId,
    originalSwitchTopic,
    onBeforeTopicSwitch,
    onAfterTopicSwitch,
    composerDraftCoordinator,
    getComposerDraftNavigationEpoch,
    startTopicProjectResolution,
    finishTopicProjectResolution,
    deferTopicSwitch,
    consumePendingTopicSwitch,
    rememberProjectId,
    getRememberedProjectId,
    loadTopicBoundProjectId: (topicId) =>
      topicById.get(topicId)?.workspaceId ||
      loadPersistedSessionWorkspaceId(topicId) ||
      loadPersistedProjectId(`agent_session_workspace_${topicId}`),
    resetTopicLocalState,
  });
  const { switchTopic } = topicSwitchRuntime;
  const resolveInitialSessionSwitch = useCallback(
    (topicId: string) => ({
      ...resolveInitialTaskSessionSwitchOptions(topicById.get(topicId)),
      // 草稿 owner 挂载会改变导航身份，解析工作区前须先等它建立。
      waitForResolution: !composerDraftCoordinator,
    }),
    [topicById, composerDraftCoordinator],
  );
  useWorkspaceInitialSessionNavigation({
    initialSessionId,
    currentSessionId,
    resolveInitialSessionSwitch,
    shouldAllowResolvedForceMatchedHydration:
      !(agentEntry === "conversation" || agentEntry === "new-task") ||
      (messagesLength === 0 && turnsLength === 0 && threadItemsLength === 0),
    shouldPauseInitialSessionNavigation:
      shouldPauseInitialSessionNavigationForTaskCenterDraft,
    shouldCancelPausedInitialSessionNavigationOnCurrentSessionChange:
      (agentEntry === "conversation" || agentEntry === "new-task") &&
      Boolean(normalizedInitialSessionId),
    shouldHydrateMatchedInitialSession:
      isAutoRestoringSession ||
      isSessionHydrating ||
      shouldHydrateEmptyMatchedInitialSession,
    switchTopic,
  });
  const tabSessionRuntime = useTaskCenterTabSessionRuntime({
    agentEntry,
    normalizedInitialSessionId,
    newChatAt,
    sessionId: currentSessionId,
    taskCenterHomeSurfaceActiveRef,
    taskCenterWorkspaceId,
    topicById,
    topics,
    setHomePendingPreviewRequest,
    setTaskCenterDraftSendRequest,
  });

  return {
    ...tabSessionRuntime,
    switchTopic,
  };
}
