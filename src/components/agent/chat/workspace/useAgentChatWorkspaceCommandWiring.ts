import { useTrayModelShortcuts } from "../hooks/useTrayModelShortcuts";
import { useCallback, useMemo, useRef } from "react";
import {
  isRuntimeSubmissionAccepted,
  runRuntimeSubmissionEffect,
} from "../hooks/agentSendResult";
import { useWorkspaceComposerDraftRuntime } from "./useWorkspaceComposerDraftRuntime";
import { useWorkspaceComposerDraftNavigation } from "./useWorkspaceComposerDraftNavigation";
import type { useAgentChatUnified } from "../hooks";
import type { useWorkspaceProjectSelection } from "../hooks/useWorkspaceProjectSelection";
import { useGeneralWorkbenchInitialDispatchRuntime } from "./useGeneralWorkbenchInitialDispatchRuntime";
import { useWorkspaceCanvasMessageSyncRuntime } from "./useWorkspaceCanvasMessageSyncRuntime";
import { useWorkspacePersistenceRuntime } from "./useWorkspacePersistenceRuntime";
import { useWorkspaceResetRuntime } from "./useWorkspaceResetRuntime";
import { useWorkspaceSendSurfaceRuntime } from "./useWorkspaceSendSurfaceRuntime";
import { useWorkspaceSessionRestore } from "./useWorkspaceSessionRestore";
import { useWorkspaceTaskCenterDraftStateRuntime } from "./useWorkspaceTaskCenterDraftStateRuntime";
import { useWorkspaceTaskCenterNavigationRuntime } from "./useWorkspaceTaskCenterNavigationRuntime";
import { useWorkspaceWorkbenchActionSurfaceRuntime } from "./useWorkspaceWorkbenchActionSurfaceRuntime";
import type { useAgentChatWorkspaceLocalDisplayState } from "./useAgentChatWorkspaceLocalDisplayState";

type DraftStateParams = Parameters<
  typeof useWorkspaceTaskCenterDraftStateRuntime
>[0];
type PersistenceParams = Parameters<typeof useWorkspacePersistenceRuntime>[0];
type InitialDispatchParams = Parameters<
  typeof useGeneralWorkbenchInitialDispatchRuntime
>[0];
type SessionRestoreParams = Parameters<typeof useWorkspaceSessionRestore>[0];
type ResetParams = Parameters<typeof useWorkspaceResetRuntime>[0];
type NavigationParams = Parameters<
  typeof useWorkspaceTaskCenterNavigationRuntime
>[0];
type TrayShortcutParams = Parameters<typeof useTrayModelShortcuts>[0];
type CanvasMessageSyncParams = Parameters<
  typeof useWorkspaceCanvasMessageSyncRuntime
>[0];
type SendSurfaceParams = Parameters<typeof useWorkspaceSendSurfaceRuntime>[0];
type WorkbenchActionParams = Parameters<
  typeof useWorkspaceWorkbenchActionSurfaceRuntime
>[0];
type ImageWorkbenchParams = SendSurfaceParams["imageWorkbench"];
type SendActionsParams = SendSurfaceParams["sendActions"];
type CanvasWorkflowParams = WorkbenchActionParams["canvasWorkflow"];
type EntryPromptParams = WorkbenchActionParams["entryPrompt"];

export type AgentChatWorkspaceCommandScope = ReturnType<
  typeof useAgentChatUnified
> &
  ReturnType<typeof useAgentChatWorkspaceLocalDisplayState> &
  ReturnType<typeof useWorkspaceProjectSelection> &
  DraftStateParams &
  Omit<PersistenceParams, "draftSendInFlight"> &
  InitialDispatchParams &
  Omit<SessionRestoreParams, "sessionFiles" | "sessionMeta"> &
  Omit<ResetParams, "resetGuideState" | "resetRestoredSessionState"> &
  Omit<
    NavigationParams,
    | "resetTopicLocalState"
    | "projectId"
    | "onBeforeTopicSwitch"
    | "onAfterTopicSwitch"
    | "composerDraftCoordinator"
    | "getComposerDraftNavigationEpoch"
    | "setHomePendingPreviewRequest"
    | "setTaskCenterDraftSendRequest"
    | "shouldHydrateEmptyMatchedInitialSession"
    | "shouldPauseInitialSessionNavigationForTaskCenterDraft"
    | "taskCenterHomeSurfaceActiveRef"
  > &
  Omit<TrayShortcutParams, "activeTheme"> &
  CanvasMessageSyncParams &
  ImageWorkbenchParams &
  Omit<
    SendActionsParams,
    | "bootstrapDispatchPreview"
    | "finalizeAfterSendSuccess"
    | "resolveSendBoundary"
    | "rollbackAfterSendFailure"
  > &
  Omit<CanvasWorkflowParams, "onRunImageWorkbenchCommand" | "sendRef"> &
  Omit<
    EntryPromptParams,
    | "consumeInitialPrompt"
    | "dismissGeneralWorkbenchEntryPrompt"
    | "generalWorkbenchEntryPrompt"
    | "handleSendRef"
    | "initialDispatchKey"
  >;

interface UseAgentChatWorkspaceCommandWiringParams<
  Scope extends AgentChatWorkspaceCommandScope,
> {
  scope: Scope;
  navigationProjectId: NavigationParams["projectId"];
  trayActiveTheme: TrayShortcutParams["activeTheme"];
  consumePendingSkill: SendSurfaceParams["pendingSkill"]["consumePendingSkill"];
  pendingSkillKey: SendSurfaceParams["pendingSkill"]["key"];
  sceneGateResumeHandlerRef: SendSurfaceParams["sceneGateResumeHandlerRef"];
  composerDraftTitle: string;
}

/** 只组合既有 command owners，不持有 runtime 或 read-model truth。 */
export function useAgentChatWorkspaceCommandWiring<
  Scope extends AgentChatWorkspaceCommandScope,
>({
  scope,
  navigationProjectId,
  trayActiveTheme,
  consumePendingSkill,
  pendingSkillKey,
  sceneGateResumeHandlerRef,
}: UseAgentChatWorkspaceCommandWiringParams<Scope>) {
  const workspaceId = scope.taskCenterWorkspaceId?.trim() || null;
  const initialSessionHydration = useRef({
    route: scope.normalizedInitialSessionId,
    resolved: false,
  });
  if (
    initialSessionHydration.current.route !== scope.normalizedInitialSessionId
  )
    initialSessionHydration.current = {
      route: scope.normalizedInitialSessionId,
      resolved: false,
    };
  if (scope.sessionId === scope.normalizedInitialSessionId)
    initialSessionHydration.current.resolved = true;
  const initialScope = useMemo(() => {
    const currentSessionId = scope.sessionId?.trim();
    if (
      scope.normalizedInitialSessionId &&
      !initialSessionHydration.current.resolved &&
      scope.normalizedInitialSessionId !== currentSessionId
    )
      return null;
    if (currentSessionId)
      return { workspaceId, kind: "local" as const, id: currentSessionId };
    if (scope.normalizedInitialSessionId) return null;
    return { workspaceId, kind: "home" as const, id: "new-conversation" };
  }, [workspaceId, scope.sessionId, scope.normalizedInitialSessionId]);
  const composerDraftRuntime = useWorkspaceComposerDraftRuntime({
    controller: scope.composerController,
    initialScope,
  });
  const taskCenterDraftState = useWorkspaceTaskCenterDraftStateRuntime({
    ...scope,
    composerDraftCoordinator: composerDraftRuntime.composerDraftCoordinator,
  });
  const { handleTopicSwitchCommitted } = useWorkspaceComposerDraftNavigation({
    newConversationRequest: scope.newConversationRequest,
    composerDraftRuntime,
    workspaceId,
    projectSelectionSource: scope.projectSelectionSource,
    normalizedInitialSessionId: scope.normalizedInitialSessionId,
    sessionId: scope.sessionId,
    onTopicSwitchCommitted: taskCenterDraftState.handleTopicSwitchCommitted,
  });
  const commitVisibleTopic = useCallback(
    (
      topicId: string,
      _runtimeWorkspaceId: string | null,
      capturedNavigationEpoch?: number,
    ) => {
      // 业务工作区可能仍在解析或使用默认值；草稿始终绑定当前可见工作区。
      handleTopicSwitchCommitted(topicId, workspaceId, capturedNavigationEpoch);
    },
    [handleTopicSwitchCommitted, workspaceId],
  );
  const persistence = useWorkspacePersistenceRuntime({
    ...scope,
    draftSendInFlight: Boolean(
      taskCenterDraftState.taskCenterDraftSendRequest ||
      taskCenterDraftState.homePendingPreviewRequest,
    ),
  });
  const initialDispatch = useGeneralWorkbenchInitialDispatchRuntime(scope);
  const sessionRestore = useWorkspaceSessionRestore({
    ...scope,
    sessionFiles: persistence.sessionFiles,
    sessionMeta: persistence.sessionMeta,
  });
  const reset = useWorkspaceResetRuntime({
    ...scope,
    composerDraftEnabled: true,
    composerDraftCoordinator: composerDraftRuntime.composerDraftCoordinator,
    onComposerDraftScopeCommitted:
      composerDraftRuntime.commitComposerDraftScope,
    composerDraftHomeWorkspaceId: workspaceId,
    resetGuideState: initialDispatch.resetGuideState,
    resetRestoredSessionState: sessionRestore.resetRestoredSessionState,
  });
  const taskCenterNavigation = useWorkspaceTaskCenterNavigationRuntime({
    ...scope,
    projectId: navigationProjectId,
    onBeforeTopicSwitch: taskCenterDraftState.handleBeforeTopicSwitch,
    onAfterTopicSwitch: commitVisibleTopic,
    composerDraftCoordinator: composerDraftRuntime.composerDraftCoordinator,
    getComposerDraftNavigationEpoch:
      composerDraftRuntime.getComposerDraftNavigationEpoch,
    resetTopicLocalState: reset.resetTopicLocalState,
    setHomePendingPreviewRequest:
      taskCenterDraftState.setHomePendingPreviewRequest,
    setTaskCenterDraftSendRequest:
      taskCenterDraftState.setTaskCenterDraftSendRequest,
    shouldHydrateEmptyMatchedInitialSession:
      taskCenterDraftState.shouldHydrateEmptyMatchedInitialSession,
    shouldPauseInitialSessionNavigationForTaskCenterDraft:
      taskCenterDraftState.shouldPauseInitialSessionNavigationForTaskCenterDraft,
    taskCenterHomeSurfaceActiveRef:
      taskCenterDraftState.taskCenterHomeSurfaceActiveRef,
  });

  useTrayModelShortcuts({
    ...scope,
    activeTheme: trayActiveTheme,
  });
  useWorkspaceCanvasMessageSyncRuntime(scope);

  const sendRuntimeMessage = scope.sendMessage;
  const {
    getComposerDraftNavigationEpoch,
    getComposerDraftTarget,
    composerDraftCoordinator,
    handleComposerDraftAccepted: promoteAcceptedDraft,
  } = composerDraftRuntime;
  const { deferTopicSwitch } = scope;
  const { handleTopicSwitchCommitted: commitAcceptedTopic } =
    taskCenterDraftState;
  const handleComposerDraftAccepted = useCallback<typeof promoteAcceptedDraft>(
    async (capture, result) => {
      const epoch = getComposerDraftNavigationEpoch();
      await promoteAcceptedDraft(capture, result);
      if (result.kind !== "runtime-accepted") return;
      const executionScope = result.receipt.executionScope;
      if (!executionScope || !capture.binding) return;
      const target = getComposerDraftTarget();
      const status = composerDraftCoordinator?.getSnapshot();
      if (
        getComposerDraftNavigationEpoch() !== epoch + 1 ||
        status?.generation !== capture.binding.generation ||
        !target ||
        target.workspaceId !== executionScope.workspaceId ||
        target.kind !== "local" ||
        target.id !== result.receipt.sessionId
      )
        return;
      deferTopicSwitch(result.receipt.sessionId, executionScope.workspaceId, {
        allowDetachedSession: true,
      });
      commitAcceptedTopic(result.receipt.sessionId);
      handleTopicSwitchCommitted(
        result.receipt.sessionId,
        executionScope.workspaceId,
      );
    },
    [
      promoteAcceptedDraft,
      getComposerDraftTarget,
      composerDraftCoordinator,
      getComposerDraftNavigationEpoch,
      deferTopicSwitch,
      commitAcceptedTopic,
      handleTopicSwitchCommitted,
    ],
  );
  const sendMessage = useCallback<typeof sendRuntimeMessage>(
    async (...args) => {
      const epoch = getComposerDraftNavigationEpoch();
      const result = await sendRuntimeMessage(...args);
      // 初始意图等程序化发送不经过 Composer settlement；仍提交真实可见会话。
      if (
        !args[8]?.composerDraft &&
        !args[8]?.executionScope &&
        isRuntimeSubmissionAccepted(result)
      )
        runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () =>
          commitVisibleTopic(result.receipt.sessionId, null, epoch),
        );
      return result;
    },
    [sendRuntimeMessage, getComposerDraftNavigationEpoch, commitVisibleTopic],
  );
  const send = useWorkspaceSendSurfaceRuntime({
    imageWorkbench: scope,
    pendingSkill: {
      consumePendingSkill,
      isThemeWorkbench: scope.isThemeWorkbench,
      key: pendingSkillKey,
    },
    sceneGateResumeHandlerRef,
    sendActions: {
      ...scope,
      getComposerDraftNavigationEpoch,
      isAcceptedExecutionScopeCurrent: (executionScope, receipt) => {
        const target = composerDraftRuntime.getComposerDraftTarget();
        return (
          target?.workspaceId === executionScope.workspaceId &&
          target.kind === "local" &&
          target.id === receipt.sessionId
        );
      },
      sendMessage,
      bootstrapDispatchPreview: initialDispatch.bootstrapDispatchPreview,
      finalizeAfterSendSuccess: initialDispatch.finalizeAfterSendSuccess,
      resolveSendBoundary: initialDispatch.resolveSendBoundary,
      rollbackAfterSendFailure: initialDispatch.rollbackAfterSendFailure,
    },
  });
  const workbenchActionsRuntime = useWorkspaceWorkbenchActionSurfaceRuntime({
    canvasWorkflow: {
      ...scope,
      onRunImageWorkbenchCommand: send.handleImageWorkbenchCommand,
      sendRef: send.handleSendRef,
    },
    entryPrompt: {
      ...scope,
      consumeInitialPrompt: initialDispatch.consumeInitialPrompt,
      dismissGeneralWorkbenchEntryPrompt:
        initialDispatch.dismissGeneralWorkbenchEntryPrompt,
      generalWorkbenchEntryPrompt: initialDispatch.generalWorkbenchEntryPrompt,
      handleSendRef: send.handleSendRef,
      initialDispatchKey: initialDispatch.initialDispatchKey,
    },
  });

  const compositionScope = {
    ...scope,
    ...composerDraftRuntime,
    handleComposerDraftAccepted,
    ...taskCenterDraftState,
    ...persistence,
    ...initialDispatch,
    ...sessionRestore,
    ...reset,
    ...taskCenterNavigation,
    ...send,
    ...workbenchActionsRuntime,
  };

  return {
    compositionScope,
    composerDraft: { ...composerDraftRuntime, handleComposerDraftAccepted },
    initialDispatch,
    persistence,
    reset,
    send,
    taskCenterDraftState,
    taskCenterNavigation,
    workbenchActions: workbenchActionsRuntime,
    scope,
  };
}
