import type { ComponentProps, ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { startReview } from "@/lib/api/review";
import {
  revertThreadHistory,
  type ThreadRevertRequest,
} from "@/lib/api/threadRevert";
import type { ThreadGoal } from "@limecloud/app-server-client";
import { StepProgress } from "@/components/workspace/layout/StepProgress";
import { useWorkspaceNavigationActions } from "./useWorkspaceNavigationActions";
import { useWorkspaceInputbarSceneRuntime } from "./useWorkspaceInputbarSceneRuntime";
import { useWorkspaceCanvasSceneRuntime } from "./useWorkspaceCanvasSceneRuntime";
import { MessageList } from "../components/MessageList";
import type { WriteArtifactContext } from "../types";
import type { PendingA2UISource } from "../types";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { TaskFile } from "../components/TaskFiles";
import type { WorkspacePathMissingState } from "../hooks/agentChatShared";
import type { SidebarActivityLog } from "../components/generalWorkbenchWorkflowData";
import type { SyncStatus } from "../hooks/useContentSync";
import type { ArtifactTimelineOpenTarget } from "../utils/artifactTimelineNavigation";
import { buildStepProgressProps } from "./chatSurfaceProps";
import { WorkspaceConversationScene } from "./WorkspaceConversationScene";
import { buildWorkspaceConversationCodingViews } from "./workspaceConversationCodingViews";
import type { AgentSessionExecutionRuntime } from "@/lib/api/agentExecutionRuntime";
import type { AgentTodoItem } from "@/lib/api/agentRuntime/sessionTypes";
import type { GeneralWorkbenchCreationTaskEvent } from "../components/generalWorkbenchWorkflowData";
import type { GeneralWorkbenchTaskRailContextInput } from "../components/generalWorkbenchTaskRailViewModel";
import type { CanonicalChildThreadSummary } from "../projection/canonicalChildThreadSummary";
import type { AgentSessionReadModelRefreshRequest } from "../hooks/agentSessionRefresh";
import { useWorkspaceTaskRailRuntime } from "./useWorkspaceTaskRailRuntime";
import { useSessionRuntimeProjectionDeferral } from "./useSessionRuntimeProjectionDeferral";
import { buildQuotedReplyText } from "./workspaceConversationSceneViewModel";
import type { WorkspaceConversationLandingSurfaceRuntime } from "./useWorkspaceConversationLandingSurfaceRuntime";
import {
  buildWorkspaceConversationRightSurfaceSceneProps,
  type WorkspaceConversationRightSurfaceChromeRuntime,
} from "./workspaceConversationRightSurfaceChrome";

type InputbarScene = Pick<
  ReturnType<typeof useWorkspaceInputbarSceneRuntime>,
  "inputbarNode" | "generalWorkbenchDialog" | "runtimeToolAvailability"
>;
type CanvasScene = Pick<
  ReturnType<typeof useWorkspaceCanvasSceneRuntime>,
  | "hasLiveCanvasPreviewContent"
  | "liveCanvasPreview"
  | "shouldShowCanvasLoadingState"
  | "canvasWorkbenchDefaultPreview"
  | "handleOpenCanvasWorkbenchPath"
  | "handleRevealCanvasWorkbenchPath"
  | "handleCloseCanvasWorkbench"
>;
type WorkspaceConversationSceneProps = ComponentProps<
  typeof WorkspaceConversationScene
>;
type CanvasWorkbenchLayoutProps = NonNullable<
  WorkspaceConversationSceneProps["canvasWorkbenchLayoutProps"]
>;
type MessageListProps = ComponentProps<typeof MessageList>;
interface ConversationScenePresentationParams {
  scene: Omit<
    WorkspaceConversationSceneProps,
    | "workspaceAlertVisible"
    | "projectId"
    | "canvasWorkbenchLayoutProps"
    | "stepProgressProps"
    | "messageListProps"
  > & {
    projectId: string | null | undefined;
  };
  stepProgress: {
    hidden: boolean;
    isSpecializedThemeMode: boolean;
    hasMessages: boolean;
    steps: ComponentProps<typeof StepProgress>["steps"];
    currentIndex: ComponentProps<typeof StepProgress>["currentIndex"];
    onStepClick: NonNullable<
      ComponentProps<typeof StepProgress>["onStepClick"]
    >;
  };
  messageList: MessageListProps;
  workspaceAlert: {
    workspacePathMissing: boolean;
    workspaceHealthError: boolean;
  };
  canvasWorkbenchLayout: CanvasWorkbenchLayoutProps;
}
interface WorkspaceConversationScenePresentationResult {
  workspaceAlertVisible: boolean;
  mainAreaNode: ReactNode;
}
type NavigationActions = Pick<
  ReturnType<typeof useWorkspaceNavigationActions>,
  | "handleDismissEntryBanner"
  | "handleWorkspaceAlertSelectDirectory"
  | "handleDismissWorkspaceAlert"
  | "handleManageProviders"
  | "handleOpenExecutionPolicySettings"
  | "handleProjectChange"
  | "handleOpenAppearanceSettings"
  | "handleOpenPluginDirectory"
  | "handleCompactContext"
>;
interface ShellChromeRuntime {
  showChatLayout: boolean;
  isWorkspaceCompactChrome: boolean;
  workflowLayoutBottomSpacing: {
    shellBottomInset: string;
    messageViewportBottomPadding: string;
  };
  shouldHideGeneralWorkbenchInputForTheme: boolean;
  shouldRenderTopBar: boolean;
  layoutTransitionChatPanelWidth?: string;
  shouldShowGeneralWorkbenchFloatingInputOverlay: boolean;
  shouldRenderInlineA2UI: boolean;
}

export interface WorkspaceConversationMessageListRuntime {
  emptyStateVariant?: "none" | "task-center";
  quoteInput: string;
  onQuoteInputChange: (value: string) => void;
  providerType: MessageListProps["providerType"];
  model: string | null | undefined;
  reasoningEffort?: string | null;
  accessMode: GeneralWorkbenchTaskRailContextInput["accessMode"];
  messages: ConversationScenePresentationParams["messageList"]["messages"];
  turns: ConversationScenePresentationParams["messageList"]["turns"];
  threadItems: ConversationScenePresentationParams["messageList"]["threadItems"];
  todoItems?: AgentTodoItem[];
  currentTurnId: ConversationScenePresentationParams["messageList"]["currentTurnId"];
  threadRead: ConversationScenePresentationParams["messageList"]["threadRead"];
  executionRuntime?: AgentSessionExecutionRuntime | null;
  pendingActions: NonNullable<
    ConversationScenePresentationParams["messageList"]["pendingActions"]
  >;
  submittedActionsInFlight: NonNullable<
    ConversationScenePresentationParams["messageList"]["submittedActionsInFlight"]
  >;
  canonicalChildren?: NonNullable<
    ConversationScenePresentationParams["messageList"]["canonicalChildren"]
  >;
  sessionHistoryWindow?: ConversationScenePresentationParams["messageList"]["sessionHistoryWindow"];
  onLoadFullHistory?: ConversationScenePresentationParams["messageList"]["onLoadFullHistory"];
  isSending: ConversationScenePresentationParams["messageList"]["isSending"];
  onInterruptCurrentTurn: ConversationScenePresentationParams["messageList"]["onInterruptCurrentTurn"];
  onReplayPendingRequest: ConversationScenePresentationParams["messageList"]["onReplayPendingRequest"];
  onDeleteMessage: ConversationScenePresentationParams["messageList"]["onDeleteMessage"];
  onEditMessage: ConversationScenePresentationParams["messageList"]["onEditMessage"];
  onA2UISubmit: ConversationScenePresentationParams["messageList"]["onA2UISubmit"];
  onWriteFile: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void | Promise<void>;
  onFileClick: ConversationScenePresentationParams["messageList"]["onFileClick"];
  onOpenArtifactFromTimeline: (target: ArtifactTimelineOpenTarget) => void;
  onOpenSavedSiteContent: ConversationScenePresentationParams["messageList"]["onOpenSavedSiteContent"];
  onArtifactClick: ConversationScenePresentationParams["messageList"]["onArtifactClick"];
  onOpenUrlPreview?: ConversationScenePresentationParams["messageList"]["onOpenUrlPreview"];
  onOpenMessagePreview?: ConversationScenePresentationParams["messageList"]["onOpenMessagePreview"];
  onSaveMessageAsSkill?: ConversationScenePresentationParams["messageList"]["onSaveMessageAsSkill"];
  onOpenSubagentSession: ConversationScenePresentationParams["messageList"]["onOpenSubagentSession"];
  onPermissionResponse: ConversationScenePresentationParams["messageList"]["onPermissionResponse"];
  onRefreshSessionReadModel?: (
    request?: AgentSessionReadModelRefreshRequest,
  ) => void | Promise<unknown>;
  collapseCodeBlocks: ConversationScenePresentationParams["messageList"]["collapseCodeBlocks"];
  shouldCollapseCodeBlock: ConversationScenePresentationParams["messageList"]["shouldCollapseCodeBlock"];
  onCodeBlockClick: ConversationScenePresentationParams["messageList"]["onCodeBlockClick"];
  focusedTimelineItemId: string | null;
  timelineFocusRequestKey: number;
}

function renderWorkspaceConversationScene({
  scene,
  stepProgress,
  messageList,
  workspaceAlert,
  canvasWorkbenchLayout,
}: ConversationScenePresentationParams): WorkspaceConversationScenePresentationResult {
  const stepProgressProps = buildStepProgressProps(stepProgress);
  const workspaceAlertVisible = Boolean(
    workspaceAlert.workspacePathMissing || workspaceAlert.workspaceHealthError,
  );

  return {
    workspaceAlertVisible,
    mainAreaNode: (
      <WorkspaceConversationScene
        {...scene}
        stepProgressProps={stepProgressProps}
        messageListProps={messageList}
        workspaceAlertVisible={workspaceAlertVisible}
        projectId={scene.projectId ?? null}
        canvasWorkbenchLayoutProps={canvasWorkbenchLayout}
      />
    ),
  };
}

const EMPTY_PROJECTED_TURNS: NonNullable<
  ConversationScenePresentationParams["messageList"]["turns"]
> = [];
const EMPTY_PROJECTED_THREAD_ITEMS: NonNullable<
  ConversationScenePresentationParams["messageList"]["threadItems"]
> = [];
const EMPTY_PROJECTED_PENDING_ACTIONS: NonNullable<
  ConversationScenePresentationParams["messageList"]["pendingActions"]
> = [];
const EMPTY_PROJECTED_SUBMITTED_ACTIONS: NonNullable<
  ConversationScenePresentationParams["messageList"]["submittedActionsInFlight"]
> = [];
interface UseWorkspaceConversationSceneRuntimeParams {
  onOpenBackgroundTerminal?: WorkspaceConversationSceneProps["onOpenBackgroundTerminal"];
  threadHeader?: WorkspaceConversationSceneProps["threadHeader"];
  navbarContextVariant?: "default" | "task-center";
  navigationActions: NavigationActions;
  inputbarScene: InputbarScene;
  canvasScene: CanvasScene;
  landingSurface: WorkspaceConversationLandingSurfaceRuntime;
  shellChromeRuntime: ShellChromeRuntime;
  contextWorkspaceEnabled: boolean;
  activeTheme: string;
  contentId: ConversationScenePresentationParams["scene"]["contentId"];
  projectId: string | null;
  openedProjects?: ConversationScenePresentationParams["scene"]["openedProjects"];
  onCloseProject?: ConversationScenePresentationParams["scene"]["onCloseProject"];
  deferWorkspaceListLoad?: ConversationScenePresentationParams["scene"]["deferWorkspaceListLoad"];
  suppressNavbarUtilityActions?: boolean;
  topBarChrome: ConversationScenePresentationParams["scene"]["navbarChrome"];
  onBackToProjectManagement?: ConversationScenePresentationParams["scene"]["onBackToProjectManagement"];
  handleBackHome: ConversationScenePresentationParams["scene"]["onBackHome"];
  rightSurfaceChrome: WorkspaceConversationRightSurfaceChromeRuntime;
  isRestoringSession: boolean;
  sessionId: string | null | undefined;
  threadGoal?: ThreadGoal | null;
  syncStatus: SyncStatus;
  pendingA2UIForm: ConversationScenePresentationParams["scene"]["pendingA2UIForm"];
  pendingA2UISource: PendingA2UISource | null;
  a2uiSubmissionNotice: ConversationScenePresentationParams["scene"]["a2uiSubmissionNotice"];
  handlePendingA2UISubmit: NonNullable<
    ConversationScenePresentationParams["scene"]["onPendingA2UISubmit"]
  >;
  handleToggleCanvas: ConversationScenePresentationParams["scene"]["onToggleCanvas"];
  currentImageWorkbenchActive: ConversationScenePresentationParams["scene"]["currentImageWorkbenchActive"];
  canvasWorkbenchPreviewOpenRequest?: ConversationScenePresentationParams["canvasWorkbenchLayout"]["previewOpenRequest"];
  onCanvasWorkbenchPreviewOpenRequestHandled?: ConversationScenePresentationParams["canvasWorkbenchLayout"]["onPreviewOpenRequestHandled"];
  hideInlineStepProgress: ConversationScenePresentationParams["stepProgress"]["hidden"];
  isSpecializedThemeMode: ConversationScenePresentationParams["stepProgress"]["isSpecializedThemeMode"];
  hasMessages: ConversationScenePresentationParams["stepProgress"]["hasMessages"];
  steps: ConversationScenePresentationParams["stepProgress"]["steps"];
  activityLogs?: SidebarActivityLog[];
  creationTaskEvents?: GeneralWorkbenchCreationTaskEvent[];
  canonicalChildren?: CanonicalChildThreadSummary[];
  currentStepIndex: ConversationScenePresentationParams["stepProgress"]["currentIndex"];
  goToStep: ConversationScenePresentationParams["stepProgress"]["onStepClick"];
  messageListRuntime: WorkspaceConversationMessageListRuntime;
  layoutMode: LayoutMode;
  isThemeWorkbench: boolean;
  settledWorkbenchArtifacts: ConversationScenePresentationParams["canvasWorkbenchLayout"]["artifacts"];
  resolvedCanvasState: ConversationScenePresentationParams["canvasWorkbenchLayout"]["canvasState"];
  taskFiles: TaskFile[];
  selectedFileId: string | undefined;
  projectRootPath: string | null;
  canvasWorkbenchRootPath?: string | null;
  handleHarnessLoadFilePreview: ConversationScenePresentationParams["canvasWorkbenchLayout"]["loadFilePreview"];
  setCanvasWorkbenchLayoutMode: ConversationScenePresentationParams["canvasWorkbenchLayout"]["onLayoutModeChange"];
  onBeforeCanvasLeaveChange?: (guard: (() => Promise<boolean>) | null) => void;
  workspacePathMissing: WorkspacePathMissingState | boolean | null;
  workspaceHealthError: boolean;
}

export function useWorkspaceConversationSceneRuntime({
  threadHeader,
  navbarContextVariant = "default",
  navigationActions,
  inputbarScene,
  canvasScene,
  landingSurface,
  shellChromeRuntime,
  contextWorkspaceEnabled,
  activeTheme,
  contentId,
  projectId,
  openedProjects,
  onCloseProject,
  deferWorkspaceListLoad,
  suppressNavbarUtilityActions = false,
  topBarChrome,
  onBackToProjectManagement,
  handleBackHome,
  rightSurfaceChrome,
  onOpenBackgroundTerminal,
  isRestoringSession,
  sessionId,
  threadGoal,
  syncStatus,
  pendingA2UIForm,
  pendingA2UISource,
  a2uiSubmissionNotice,
  handlePendingA2UISubmit,
  handleToggleCanvas,
  currentImageWorkbenchActive,
  canvasWorkbenchPreviewOpenRequest,
  onCanvasWorkbenchPreviewOpenRequestHandled,
  hideInlineStepProgress,
  isSpecializedThemeMode,
  hasMessages,
  steps,
  activityLogs = [],
  creationTaskEvents = [],
  canonicalChildren = [],
  currentStepIndex,
  goToStep,
  messageListRuntime,
  layoutMode,
  isThemeWorkbench,
  settledWorkbenchArtifacts,
  resolvedCanvasState,
  taskFiles,
  selectedFileId,
  projectRootPath,
  canvasWorkbenchRootPath,
  handleHarnessLoadFilePreview,
  setCanvasWorkbenchLayoutMode,
  onBeforeCanvasLeaveChange,
  workspacePathMissing,
  workspaceHealthError,
}: UseWorkspaceConversationSceneRuntimeParams) {
  const {
    emptyStateVariant: messageListEmptyStateVariant = "none",
    quoteInput,
    onQuoteInputChange,
    providerType,
    model,
    reasoningEffort,
    accessMode,
    messages: displayMessages,
    turns = EMPTY_PROJECTED_TURNS,
    threadItems: effectiveThreadItems = EMPTY_PROJECTED_THREAD_ITEMS,
    todoItems = [],
    currentTurnId,
    threadRead,
    executionRuntime,
    pendingActions = EMPTY_PROJECTED_PENDING_ACTIONS,
    submittedActionsInFlight = EMPTY_PROJECTED_SUBMITTED_ACTIONS,
    sessionHistoryWindow = null,
    onLoadFullHistory,
    isSending,
    onInterruptCurrentTurn,
    onReplayPendingRequest,
    onDeleteMessage,
    onEditMessage,
    onA2UISubmit,
    onWriteFile,
    onFileClick,
    onOpenArtifactFromTimeline,
    onOpenSavedSiteContent,
    onArtifactClick,
    onOpenUrlPreview,
    onOpenMessagePreview,
    onSaveMessageAsSkill,

    onOpenSubagentSession,
    onPermissionResponse,
    onRefreshSessionReadModel,
    collapseCodeBlocks,
    shouldCollapseCodeBlock,
    onCodeBlockClick,
    focusedTimelineItemId,
    timelineFocusRequestKey,
  } = messageListRuntime;
  const projectedRuntime = useSessionRuntimeProjectionDeferral({
    sessionId,
    messages: displayMessages,
    turns,
    threadItems: effectiveThreadItems,
    currentTurnId,
    threadRead,
    pendingActions,
    submittedActionsInFlight,
    isRestoringSession,
    isSending: Boolean(isSending),
    focusedTimelineItemId,
    pendingA2UIForm,
  });
  const projectedTurns = projectedRuntime.turns;
  const projectedThreadItems = projectedRuntime.threadItems;
  const projectedCurrentTurnId = projectedRuntime.currentTurnId;
  const projectedThreadRead = projectedRuntime.threadRead;
  const projectedPendingActions = projectedRuntime.pendingActions;
  const projectedSubmittedActionsInFlight =
    projectedRuntime.submittedActionsInFlight;
  const handleQuoteMessage = (content: string) => {
    const quotedText = buildQuotedReplyText({
      content,
      input: quoteInput,
    });
    if (!quotedText) {
      return;
    }
    onQuoteInputChange(quotedText);
  };

  const navbarUtilityActionsVisible = !suppressNavbarUtilityActions;
  const taskCenterUtilityActionsVisible =
    navbarUtilityActionsVisible || navbarContextVariant === "task-center";
  const rightSurfaceSceneProps =
    buildWorkspaceConversationRightSurfaceSceneProps({
      rightSurfaceChrome,
      utilityActionsVisible: taskCenterUtilityActionsVisible,
    });
  const shouldSyncCanvasWorkbenchLayoutMode =
    !isThemeWorkbench &&
    activeTheme === "general" &&
    layoutMode === "chat-canvas";
  const onStartReview = useCallback(async () => {
    const reviewThreadId = projectedThreadRead?.thread_id?.trim() || "";
    if (!reviewThreadId) {
      throw new Error("Review requires an active thread");
    }
    const result = await startReview(
      {
        threadId: reviewThreadId,
        target: { type: "uncommittedChanges" },
      },
      {
        onTerminal: async () => {
          await onRefreshSessionReadModel?.();
        },
      },
    );
    await onRefreshSessionReadModel?.();
    if (result.reviewThreadId !== reviewThreadId) {
      onOpenSubagentSession?.(result.reviewThreadId);
    }
    return result;
  }, [
    onRefreshSessionReadModel,
    onOpenSubagentSession,
    projectedThreadRead?.thread_id,
  ]);
  const onRevertThread = useCallback(
    async (request: ThreadRevertRequest) => {
      const activeThreadId = projectedThreadRead?.thread_id?.trim() || "";
      if (!activeThreadId || request.threadId.trim() !== activeThreadId) {
        throw new Error("Thread revert target is no longer active");
      }
      await revertThreadHistory({
        threadId: activeThreadId,
        beforeTurnId: request.beforeTurnId,
      });
      await onRefreshSessionReadModel?.({ timelineMode: "replace" });
    },
    [onRefreshSessionReadModel, projectedThreadRead?.thread_id],
  );
  const codingWorkbenchViews = useMemo(
    () =>
      buildWorkspaceConversationCodingViews({
        turns: projectedTurns,
        threadItems: projectedThreadItems,
        currentTurnId: projectedCurrentTurnId,
        threadRead: projectedThreadRead,
        pendingActions: projectedPendingActions,
        isSending,
        onOpenFile: canvasScene.handleOpenCanvasWorkbenchPath,
        onStartReview,
      }),
    [
      canvasScene.handleOpenCanvasWorkbenchPath,
      onStartReview,
      isSending,
      projectedCurrentTurnId,
      projectedPendingActions,
      projectedThreadItems,
      projectedThreadRead,
      projectedTurns,
    ],
  );
  const sessionRuntimeCounters = codingWorkbenchViews.counters;
  const shouldUseCodingWorkbenchChrome =
    sessionRuntimeCounters.shouldUseRuntimeWorkbench ||
    navbarContextVariant === "task-center";
  const effectiveCanvasWorkbenchRootPath =
    projectRootPath?.trim() || canvasWorkbenchRootPath?.trim() || null;
  const taskRailProps = useWorkspaceTaskRailRuntime({
    sessionId,
    workflowSteps: steps,
    messages: displayMessages,
    activityLogs,
    creationTaskEvents,
    pendingActions: projectedPendingActions,
    submittedActionsInFlight: projectedSubmittedActionsInFlight,
    threadItems: projectedThreadItems,
    todoItems,
    threadGoal,
    threadRead: projectedThreadRead,
    executionRuntime,
    canonicalChildren,
    providerType,
    model,
    accessMode,
    reasoningEffort,
    projectRootPath,
    canvasWorkbenchRootPath,
    onOpenWorkspacePath: canvasScene.handleOpenCanvasWorkbenchPath,
    onRespondToAction: onPermissionResponse,
  });
  return renderWorkspaceConversationScene({
    scene: {
      threadHeader,
      onOpenPluginDirectory: navigationActions.handleOpenPluginDirectory,
      landingSurface,
      showChatLayout: shellChromeRuntime.showChatLayout,
      compactChrome: shellChromeRuntime.isWorkspaceCompactChrome,
      contextWorkspaceEnabled,
      generalWorkbenchMessageViewportBottomPadding:
        shellChromeRuntime.workflowLayoutBottomSpacing
          .messageViewportBottomPadding,
      taskRail: taskRailProps,
      onSelectWorkspaceDirectory:
        navigationActions.handleWorkspaceAlertSelectDirectory,
      onDismissWorkspaceAlert: navigationActions.handleDismissWorkspaceAlert,
      shouldHideGeneralWorkbenchInputForTheme:
        shellChromeRuntime.shouldHideGeneralWorkbenchInputForTheme,
      inputbarNode: inputbarScene.inputbarNode,
      contentId,
      projectId,
      openedProjects,
      projectRootPath,
      deferWorkspaceListLoad,
      onProjectChange: navigationActions.handleProjectChange,
      onCloseProject,
      onOpenSettings: navbarUtilityActionsVisible
        ? navigationActions.handleOpenAppearanceSettings
        : undefined,
      workspaceType: activeTheme,
      navbarVisible: shellChromeRuntime.shouldRenderTopBar,
      isRunning: Boolean(isSending),
      navbarChrome: topBarChrome,
      navbarContextVariant,
      onBackToProjectManagement,
      isThemeWorkbench,
      layoutMode,
      onToggleCanvas: handleToggleCanvas,
      onBackHome: handleBackHome,
      ...rightSurfaceSceneProps,
      onOpenBackgroundTerminal,
      onRefreshThread: onRefreshSessionReadModel,
      showContextCompactionAction:
        navbarUtilityActionsVisible &&
        Boolean(sessionId) &&
        projectedThreadRead?.can_accept_direct_input !== false,
      contextCompactionRunning: navbarUtilityActionsVisible && isSending,
      onCompactContext:
        navbarUtilityActionsVisible &&
        projectedThreadRead?.can_accept_direct_input !== false
          ? navigationActions.handleCompactContext
          : undefined,
      syncStatus,
      pendingA2UIForm,
      onPendingA2UISubmit: handlePendingA2UISubmit,
      a2uiSubmissionNotice,
      hasLiveCanvasPreviewContent: canvasScene.hasLiveCanvasPreviewContent,
      liveCanvasPreview: canvasScene.liveCanvasPreview,
      currentImageWorkbenchActive,
      shouldShowCanvasLoadingState: canvasScene.shouldShowCanvasLoadingState,
      shellBottomInset:
        shellChromeRuntime.workflowLayoutBottomSpacing.shellBottomInset,
      chatPanelWidth: shellChromeRuntime.layoutTransitionChatPanelWidth,
      generalWorkbenchDialog: inputbarScene.generalWorkbenchDialog,
      showFloatingInputOverlay:
        shellChromeRuntime.shouldShowGeneralWorkbenchFloatingInputOverlay,
      hasPendingA2UIForm: Boolean(pendingA2UIForm),
    },
    stepProgress: {
      hidden: hideInlineStepProgress,
      isSpecializedThemeMode,
      hasMessages,
      steps,
      currentIndex: currentStepIndex,
      onStepClick: goToStep,
    },
    messageList: {
      sessionId,
      messages: displayMessages,
      emptyStateVariant: messageListEmptyStateVariant,
      providerType,
      turns: projectedTurns,
      threadItems: projectedThreadItems,
      currentTurnId: projectedCurrentTurnId,
      threadRead: projectedThreadRead,
      pendingActions: projectedPendingActions,
      submittedActionsInFlight: projectedSubmittedActionsInFlight,
      canonicalChildren,
      sessionHistoryWindow,
      onLoadFullHistory,
      isRestoringSession,
      isSending,
      onInterruptCurrentTurn,
      onReplayPendingRequest,
      onDeleteMessage,
      onEditMessage,
      onQuoteMessage: handleQuoteMessage,
      onRevertThread,
      onA2UISubmit,
      onWriteFile,
      onFileClick,
      onOpenArtifactFromTimeline,
      onOpenSavedSiteContent,
      onArtifactClick,
      onOpenUrlPreview,
      onOpenMessagePreview,
      onSaveMessageAsSkill,

      onOpenSubagentSession,
      onPermissionResponse,
      renderA2UIInline: shellChromeRuntime.shouldRenderInlineA2UI,
      activePendingA2UISource: pendingA2UISource,
      collapseCodeBlocks,
      shouldCollapseCodeBlock,
      onCodeBlockClick,
      focusedTimelineItemId,
      timelineFocusRequestKey,
    },
    workspaceAlert: {
      workspacePathMissing: Boolean(workspacePathMissing),
      workspaceHealthError,
    },
    canvasWorkbenchLayout: {
      artifacts: settledWorkbenchArtifacts,
      canvasState: resolvedCanvasState,
      taskFiles,
      selectedFileId,
      workspaceRoot: effectiveCanvasWorkbenchRootPath,
      defaultPreview: canvasScene.canvasWorkbenchDefaultPreview,
      loadFilePreview: handleHarnessLoadFilePreview,
      onOpenPath: canvasScene.handleOpenCanvasWorkbenchPath,
      onRevealPath: canvasScene.handleRevealCanvasWorkbenchPath,
      onClose: canvasScene.handleCloseCanvasWorkbench,
      onBeforeLeaveChange: onBeforeCanvasLeaveChange,
      workbenchMode: shouldUseCodingWorkbenchChrome ? "coding" : "default",
      changeView: codingWorkbenchViews.changeView,
      onLayoutModeChange: shouldSyncCanvasWorkbenchLayoutMode
        ? setCanvasWorkbenchLayoutMode
        : undefined,
      previewOpenRequest: canvasWorkbenchPreviewOpenRequest,
      onPreviewOpenRequestHandled: onCanvasWorkbenchPreviewOpenRequestHandled,
    },
  });
}
