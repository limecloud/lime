import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  TaskCenterDraftSendRequest,
  TaskCenterSessionReadyOptions,
} from "../homePendingPreview";
import type { ComposerDraftNavigationCallbacks } from "./composerDraftNavigation";
import type { ComposerDraftStatus } from "@/components/input-kit/ComposerDraftCoordinator";
import type { InputbarSendHandler } from "../components/Inputbar/inputbarSendPayload";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";
import {
  useTaskCenterDraftSendDispatchRuntime,
  useTaskCenterEmptyStateSendRuntime,
} from "./useTaskCenterDraftSendRuntime";
import {
  resolveWorkspaceSceneSessionProjection,
  type WorkspaceSceneSessionProjection,
} from "./workspaceSceneSessionProjection";
import type { TaskCenterHomeSurfaceState } from "./agentChatWorkspaceHelpers";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";

interface UseWorkspaceTaskCenterSendRuntimeParams<
  TMessage,
  TTurn,
  TThreadItem,
  TThreadRead,
  TExecutionRuntime,
  TPendingAction,
  TSubmittedAction,
> extends Pick<
  ComposerDraftNavigationCallbacks,
  "composerDraftCoordinator" | "getComposerDraftNavigationEpoch"
> {
  activeSessionIdRef?: MutableRefObject<string | null>;
  agentEntry: string;
  currentSessionId?: string | null;
  currentTurnId: string | null;
  displayMessages: TMessage[];
  effectiveThreadItems: TThreadItem[];
  executionRuntime: TExecutionRuntime | null;
  handleSend: WorkspaceHandleSend;
  hasDisplayMessages: boolean;
  homePendingPreviewMessages: TMessage[];
  bootstrapPendingPreviewMessages: TMessage[];
  input: string;
  isPreparingSend: boolean;
  isSending: boolean;
  isTaskCenterDraftSendPending: boolean;
  layoutMode: LayoutMode;
  markNewChatRequestHandled: (requestKey: string) => void;
  markTaskCenterLocalSessionOverride: (topicId: string) => void;
  messagesLength: number;
  newChatAt?: number;
  normalizedInitialSessionId?: string | null;
  planComposerPendingActions: TPendingAction[];
  sendRef: MutableRefObject<WorkspaceHandleSend>;
  setDetachedTopicId: Dispatch<SetStateAction<string | null>>;
  setHomePendingPreviewRequest: Dispatch<
    SetStateAction<TaskCenterDraftSendRequest | null>
  >;
  setInput: (value: string) => void;
  setTaskCenterDraftSendRequest: Dispatch<
    SetStateAction<TaskCenterDraftSendRequest | null>
  >;
  setTransitionTopicId: Dispatch<SetStateAction<string | null>>;
  shouldRenderTaskCenterEmbeddedHome: boolean;
  shouldSuppressTaskCenterDraftContent: boolean;
  submittedActionsInFlight: TSubmittedAction[];
  taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
  taskCenterHomeSurfaceActiveRef: MutableRefObject<boolean>;
  taskCenterHomeSurfaceState: TaskCenterHomeSurfaceState;
  taskCenterWorkspaceId?: string | null;
  threadRead: TThreadRead | null;
  turns: TTurn[];
  switchToReadySession?: (
    sessionId: string,
    options?: { forceRefresh?: boolean; allowDetachedSession?: boolean },
  ) => Promise<unknown>;
  upsertTaskCenterOpenTab: (
    topicId: string,
    workspaceIdOverride?: string | null,
  ) => void;
}

type WorkspaceTaskCenterSendRuntime<
  TMessage,
  TTurn,
  TThreadItem,
  TThreadRead,
  TExecutionRuntime,
  TPendingAction,
  TSubmittedAction,
> = WorkspaceSceneSessionProjection<
  TMessage,
  TTurn,
  TThreadItem,
  TThreadRead,
  TExecutionRuntime,
  TPendingAction,
  TSubmittedAction
> & {
  handleSendFromEmptyState: InputbarSendHandler;
  sceneIsRestoringSession: boolean;
  sceneLayoutMode: LayoutMode;
  sceneMessageListEmptyStateVariant: "task-center" | "none";
  sceneSessionId: string | null;
  shouldHideCurrentSessionContent: boolean;
};

export function shouldSwitchToReadyTaskCenterSession(params: {
  readySessionId: string;
  currentSessionId?: string | null;
  activeSessionId?: string | null;
}): boolean {
  const readySessionId = params.readySessionId.trim();
  if (!readySessionId) {
    return false;
  }

  return ![params.currentSessionId, params.activeSessionId]
    .map((sessionId) => sessionId?.trim() || null)
    .includes(readySessionId);
}

/** 只允许发送时的编辑目标；同一绑定的已接受 promotion 可继续接管。 */
export function isTaskCenterSendSourceCurrent(
  options: TaskCenterSessionReadyOptions,
  current: {
    sessionId: string | null;
    workspaceId: string | null;
    navigationEpoch: number | null;
    newChatAt: number | null;
    composerDraftStatus?: Pick<
      ComposerDraftStatus,
      "generation" | "scope" | "identity"
    >;
  },
  acceptedSessionId?: string,
): boolean {
  const source = options.sendSource;
  const binding = options.composerDraftCapture?.binding;
  const status = current.composerDraftStatus;
  if (binding && !status) return false;
  const executionScope =
    options.acceptedResult?.kind === "runtime-accepted"
      ? options.acceptedResult.receipt.executionScope
      : undefined;
  if (
    executionScope &&
    (executionScope.sourceWorkspaceId !==
      (source?.workspaceId ?? binding?.scope.workspaceId) ||
      options.acceptedResult?.receipt.sessionId !== acceptedSessionId)
  )
    return false;
  const acceptedWorkspaceId =
    executionScope?.workspaceId ?? binding?.scope.workspaceId;
  const promoted = Boolean(
    binding &&
    status &&
    acceptedSessionId &&
    status.generation === binding.generation &&
    status.scope?.workspaceId === acceptedWorkspaceId &&
    status.scope?.kind === "local" &&
    status.scope?.id === acceptedSessionId,
  );
  if (binding && status) {
    const matchesIdentity =
      status.identity?.draftId === binding.identity.draftId &&
      status.identity?.scopeVersion === binding.identity.scopeVersion;
    if (!matchesIdentity && !(promoted && status.identity === null))
      return false;
  }
  if (
    binding &&
    status &&
    !promoted &&
    (status.generation !== binding.generation ||
      status.scope?.workspaceId !== binding.scope.workspaceId ||
      status.scope?.kind !== binding.scope.kind ||
      status.scope?.id !== binding.scope.id)
  )
    return false;
  if (!source) return true;
  if (
    (source.workspaceId !== current.workspaceId &&
      !(
        executionScope?.sourceWorkspaceId === source.workspaceId &&
        executionScope.workspaceId === current.workspaceId &&
        current.sessionId === acceptedSessionId
      )) ||
    source.newChatAt !== current.newChatAt
  )
    return false;
  if (
    source.navigationEpoch !== current.navigationEpoch &&
    !(
      promoted &&
      source.navigationEpoch !== null &&
      current.navigationEpoch === source.navigationEpoch + 1
    )
  )
    return false;
  return (
    source.sessionId === current.sessionId ||
    current.sessionId === acceptedSessionId
  );
}

export function useWorkspaceTaskCenterSendRuntime<
  TMessage,
  TTurn,
  TThreadItem,
  TThreadRead,
  TExecutionRuntime,
  TPendingAction,
  TSubmittedAction,
>({
  activeSessionIdRef,
  agentEntry,
  composerDraftCoordinator,
  getComposerDraftNavigationEpoch,
  currentSessionId,
  currentTurnId,
  displayMessages,
  effectiveThreadItems,
  executionRuntime,
  handleSend,
  hasDisplayMessages,
  homePendingPreviewMessages,
  bootstrapPendingPreviewMessages,
  input,
  isPreparingSend,
  isSending,
  isTaskCenterDraftSendPending,
  layoutMode,
  markNewChatRequestHandled,
  markTaskCenterLocalSessionOverride,
  messagesLength,
  newChatAt,
  normalizedInitialSessionId,
  planComposerPendingActions,
  sendRef,
  setDetachedTopicId,
  setHomePendingPreviewRequest,
  setInput,
  setTaskCenterDraftSendRequest,
  setTransitionTopicId,
  shouldRenderTaskCenterEmbeddedHome,
  shouldSuppressTaskCenterDraftContent,
  submittedActionsInFlight,
  taskCenterDraftSendRequest,
  taskCenterHomeSurfaceActiveRef,
  taskCenterHomeSurfaceState,
  taskCenterWorkspaceId,
  threadRead,
  turns,
  switchToReadySession,
  upsertTaskCenterOpenTab,
}: UseWorkspaceTaskCenterSendRuntimeParams<
  TMessage,
  TTurn,
  TThreadItem,
  TThreadRead,
  TExecutionRuntime,
  TPendingAction,
  TSubmittedAction
>): WorkspaceTaskCenterSendRuntime<
  TMessage,
  TTurn,
  TThreadItem,
  TThreadRead,
  TExecutionRuntime,
  TPendingAction,
  TSubmittedAction
> {
  const currentSendSourceRef = useRef({
    currentSessionId,
    taskCenterWorkspaceId,
    newChatAt,
  });
  currentSendSourceRef.current = {
    currentSessionId,
    taskCenterWorkspaceId,
    newChatAt,
  };
  const isSendSourceCurrent = useCallback(
    (options: TaskCenterSessionReadyOptions, acceptedSessionId?: string) => {
      const latest = currentSendSourceRef.current;
      return isTaskCenterSendSourceCurrent(
        options,
        {
          sessionId:
            activeSessionIdRef?.current ?? latest.currentSessionId ?? null,
          workspaceId: latest.taskCenterWorkspaceId ?? null,
          navigationEpoch: getComposerDraftNavigationEpoch?.() ?? null,
          newChatAt: latest.newChatAt ?? null,
          composerDraftStatus: composerDraftCoordinator?.getSnapshot(),
        },
        acceptedSessionId,
      );
    },
    [
      activeSessionIdRef,
      composerDraftCoordinator,
      getComposerDraftNavigationEpoch,
    ],
  );
  const handleSessionAccepted = useCallback(
    (readySessionId: string, options?: TaskCenterSessionReadyOptions) => {
      const acceptedSessionId = options?.acceptedResult?.receipt.sessionId;
      if (acceptedSessionId && acceptedSessionId !== readySessionId) return;
      if (options && !isSendSourceCurrent(options, acceptedSessionId)) return;
      const sourceNewChatAt = options?.sendSource?.newChatAt ?? newChatAt;
      if (typeof sourceNewChatAt === "number") {
        markNewChatRequestHandled(String(sourceNewChatAt));
      }
      taskCenterHomeSurfaceActiveRef.current = false;
      setTransitionTopicId(null);
      setDetachedTopicId(null);
      const executionScope =
        options?.acceptedResult?.kind === "runtime-accepted"
          ? options.acceptedResult.receipt.executionScope
          : undefined;
      upsertTaskCenterOpenTab(
        readySessionId,
        executionScope?.workspaceId ??
          options?.sendSource?.workspaceId ??
          taskCenterWorkspaceId,
      );
      markTaskCenterLocalSessionOverride(readySessionId);
      if (
        !executionScope &&
        shouldSwitchToReadyTaskCenterSession({
          readySessionId,
          currentSessionId,
          activeSessionId: activeSessionIdRef?.current,
        })
      ) {
        void switchToReadySession?.(readySessionId, {
          allowDetachedSession: true,
          forceRefresh: true,
        });
      }
    },
    [
      currentSessionId,
      isSendSourceCurrent,
      activeSessionIdRef,
      markNewChatRequestHandled,
      markTaskCenterLocalSessionOverride,
      newChatAt,
      setDetachedTopicId,
      setTransitionTopicId,
      switchToReadySession,
      taskCenterHomeSurfaceActiveRef,
      taskCenterWorkspaceId,
      upsertTaskCenterOpenTab,
    ],
  );

  const handleSendFromEmptyState = useTaskCenterEmptyStateSendRuntime({
    agentEntry,
    input,
    setInput,
    activeSessionIdRef,
    getComposerDraftNavigationEpoch,
    isSendSourceCurrent,
    newChatAt,
    hasDisplayMessages,
    handleSend,
    sessionId: currentSessionId,
    taskCenterWorkspaceId,
    setTaskCenterDraftSendRequest,
    taskCenterDraftSendRequest,
    setHomePendingPreviewRequest,
    onSessionAccepted: handleSessionAccepted,
  });

  useTaskCenterDraftSendDispatchRuntime({
    taskCenterDraftSendRequest,
    setTaskCenterDraftSendRequest,
    setHomePendingPreviewRequest,
    messagesLength,
    currentSessionId,
    onSessionAccepted: handleSessionAccepted,
    isSendSourceCurrent,
    restoreInput: setInput,
    sendRef,
    workspaceId: taskCenterWorkspaceId,
  });

  return {
    handleSendFromEmptyState,
    sceneIsRestoringSession: taskCenterHomeSurfaceState.isRestoringSession,
    sceneLayoutMode: shouldRenderTaskCenterEmbeddedHome ? "chat" : layoutMode,
    sceneMessageListEmptyStateVariant:
      agentEntry === "conversation" &&
      !normalizedInitialSessionId &&
      !shouldRenderTaskCenterEmbeddedHome &&
      !shouldSuppressTaskCenterDraftContent
        ? "task-center"
        : "none",
    sceneSessionId: taskCenterHomeSurfaceState.sceneSessionId,
    shouldHideCurrentSessionContent:
      taskCenterHomeSurfaceState.shouldHideCurrentSessionContent,
    ...resolveWorkspaceSceneSessionProjection({
      shouldHideCurrentSessionContent:
        taskCenterHomeSurfaceState.shouldHideCurrentSessionContent,
      displayMessages,
      homePendingPreviewMessages:
        homePendingPreviewMessages.length > 0
          ? homePendingPreviewMessages
          : bootstrapPendingPreviewMessages,
      turns,
      effectiveThreadItems,
      currentTurnId,
      threadRead,
      executionRuntime,
      planComposerPendingActions,
      submittedActionsInFlight,
      isPreparingSend,
      isTaskCenterDraftSendPending,
      isSending,
    }),
  };
}
