import type { MutableRefObject } from "react";

import type { CanvasState as GeneralCanvasState } from "@/components/general-chat/bridge";
import type { AgentChatWorkspaceProps } from "../agentChatWorkspaceContract";
import type { TaskFile } from "../components/TaskFiles";
import { resolveAgentChatWorkspaceShellViewModel } from "../agentChatWorkspaceShellViewModel";
import type { useAgentChatWorkspaceCommandWiring } from "./useAgentChatWorkspaceCommandWiring";
import type { useAgentChatWorkspaceLocalDisplayState } from "./useAgentChatWorkspaceLocalDisplayState";
import type { useWorkspaceArtifactCanvasRuntime } from "./useWorkspaceArtifactCanvasRuntime";
import { useWorkspaceCanvasSurfaceRuntime } from "./useWorkspaceCanvasSurfaceRuntime";
import type { useWorkspaceContextSurfaceRuntime } from "./useWorkspaceContextSurfaceRuntime";
import type { useWorkspaceGeneralWorkbenchRuntime } from "./useWorkspaceGeneralWorkbenchRuntime";
import type { useWorkspaceImageWorkbenchSessionRuntime } from "./useWorkspaceImageWorkbenchSessionRuntime";
import { useWorkspaceTaskCenterInteractionRuntime } from "./useWorkspaceTaskCenterInteractionRuntime";
import { useWorkspaceTaskCenterSurfaceRuntime } from "./useWorkspaceTaskCenterSurfaceRuntime";

type CommandCompositionScope = ReturnType<
  typeof useAgentChatWorkspaceCommandWiring
>["compositionScope"];
type ContextSurfaceRuntime = ReturnType<
  typeof useWorkspaceContextSurfaceRuntime
>;
type ArtifactCanvasRuntime = ReturnType<
  typeof useWorkspaceArtifactCanvasRuntime
>;
type ImageWorkbenchSessionRuntime = ReturnType<
  typeof useWorkspaceImageWorkbenchSessionRuntime
>;
type GeneralWorkbenchRuntime = ReturnType<
  typeof useWorkspaceGeneralWorkbenchRuntime
>;

interface UseAgentChatWorkspaceShellInteractionRuntimeParams {
  scope: CommandCompositionScope;
  localDisplayRuntime: ReturnType<
    typeof useAgentChatWorkspaceLocalDisplayState
  >;
  contextSurfaceRuntime: ContextSurfaceRuntime;
  artifactCanvasRuntime: ArtifactCanvasRuntime;
  imageWorkbenchSessionRuntime: ImageWorkbenchSessionRuntime;
  documentEditorFocusedRef: GeneralWorkbenchRuntime["documentEditorFocusedRef"];

  activeSessionIdRef: MutableRefObject<string | null>;
  agentEntry: NonNullable<AgentChatWorkspaceProps["agentEntry"]>;
  clearEntryPendingA2UI: () => void;
  generalCanvasState: GeneralCanvasState;
  hasPendingA2UIForm: boolean;
  initialPendingServiceSkillLaunchSignature: string | null;
  sessionRestorePresentation: "foreground" | "background";
  selectedFileId?: string;
  shouldBootstrapCanvasOnEntry: boolean;
  shouldPreserveBlankHomeSurface: boolean;
  shouldUseBrowserWorkspaceHomeChrome: boolean;
  showChatPanel: boolean;
  taskCenterWorkspaceId: string | null;
  taskFiles: TaskFile[];
  onHasMessagesChange?: (hasMessages: boolean) => void;
}

/** 组合 Workspace 壳层交互，不持有 Thread/Turn/Item 或 Task Center 状态事实源。 */
export function useAgentChatWorkspaceShellInteractionRuntime({
  scope,
  localDisplayRuntime,
  contextSurfaceRuntime,
  artifactCanvasRuntime,
  imageWorkbenchSessionRuntime,
  documentEditorFocusedRef,

  activeSessionIdRef,
  agentEntry,
  clearEntryPendingA2UI,
  generalCanvasState,
  hasPendingA2UIForm,
  initialPendingServiceSkillLaunchSignature,
  sessionRestorePresentation,
  selectedFileId,
  shouldBootstrapCanvasOnEntry,
  shouldPreserveBlankHomeSurface,
  shouldUseBrowserWorkspaceHomeChrome,
  showChatPanel,
  taskCenterWorkspaceId,
  taskFiles,
  onHasMessagesChange,
}: UseAgentChatWorkspaceShellInteractionRuntimeParams) {
  const {
    activeTheme,
    autoCollapsedTopicSidebarRef,
    bootstrapDispatchPreview,
    canvasState,
    clearTaskCenterEmbeddedHomeSession,
    contentId,
    defaultTopicSidebarVisible,
    displayMessages,
    executionStrategy,
    homePendingPreviewRequest,
    initialDispatchKey,
    initialSessionId,
    isAutoRestoringSession,
    isBootstrapDispatchPending,
    isPreparingSend,
    isSending,
    isTaskCenterEntry,
    mappedTheme,
    markTaskCenterLocalSessionOverride,
    messages,
    normalizedInitialSessionId,
    queuedTurnCount,
    replaceTaskCenterOpenTabs,
    sessionId,
    setCanvasState,
    setGeneralCanvasState,
    setLayoutMode,
    setSelectedFileId,
    setSelectedText,
    setShowSidebar,
    setTaskCenterDetachedTopicId,
    setTaskCenterLocalSessionOverride,
    setTaskCenterOpenTabMap,
    setTaskCenterTransitionTopicId,
    shouldUseCompactGeneralWorkbench,
    switchTopic,
    taskCenterDetachedTopicId,
    taskCenterDraftSendRequest,
    taskCenterHomeSurfaceActiveRef,
    taskCenterEmbeddedHomeSessionIds,
    taskCenterFallbackRestoreRef,
    taskCenterLocalSessionOverride,
    taskCenterOpenTabIds,
    taskCenterOpenTabIdsRef,
    taskCenterTransitionTopicId,
    topicById,
    topics,
    upsertTaskCenterOpenTab,
  } = scope;
  const {
    canvasWorkbenchLayoutMode,
    layoutMode,
    setCanvasWorkbenchLayoutMode,
    showSidebar,
  } = localDisplayRuntime;
  const { contextHarnessRuntime, effectiveThreadItems } = contextSurfaceRuntime;
  const { harnessPanelVisible, setHarnessPanelVisible } = contextHarnessRuntime;
  const { currentCanvasArtifact } = artifactCanvasRuntime;
  const { resetLocalImageWorkbenchSessionScope } = imageWorkbenchSessionRuntime;

  const taskCenterSurfaceRuntime = useWorkspaceTaskCenterSurfaceRuntime({
    bootstrapDispatchPreview,
    draftSurface: {
      agentEntry,
      isTaskCenterEntry,
      draftSurfaceActive: taskCenterHomeSurfaceActiveRef.current,
      initialSessionId: normalizedInitialSessionId,
      sessionId,
      draftSendRequest: taskCenterDraftSendRequest,
      displayMessageCount: displayMessages.length,
      threadItemCount: effectiveThreadItems.length,
      hasLocalSessionOverride: taskCenterLocalSessionOverride !== null,
      hasPendingA2UIForm,
      isPreparingSend,
      isSending,
      queuedTurnCount,
    },
    homePendingPreview: {
      homePendingPreviewRequest,
      displayMessagesLength: displayMessages.length,
      executionStrategy,
      workspaceId: taskCenterWorkspaceId,

    },
  });
  const {
    isTaskCenterDraftSurfaceActive,
    shouldSuppressTaskCenterDraftContent,
    isHomePendingPreviewActive,
    isHomeSendStarting,
  } = taskCenterSurfaceRuntime;

  const hasCanvasWorkbenchContent = layoutMode !== "chat";
  const shellViewModel = resolveAgentChatWorkspaceShellViewModel({
    agentEntry,
    showChatPanel,
    contentId,
    initialSessionId,
    displayMessageCount: displayMessages.length,
    threadItemCount: effectiveThreadItems.length,
    isHomePendingPreviewActive,
    shouldSuppressTaskCenterDraftContent,
    hasCanvasWorkbenchContent,
    isThemeWorkbench: contextHarnessRuntime.isThemeWorkbench,
    shouldUseCompactGeneralWorkbench,
    isBootstrapDispatchPending,
    isSending,
    queuedTurnCount,
  });
  const { hasDisplayMessages, hasMessages, effectiveShowChatPanel } =
    shellViewModel;

  const canvasSurfaceRuntime = useWorkspaceCanvasSurfaceRuntime({
    layout: {
      canvasScopeKey: JSON.stringify([
        contentId,
        sessionId,
        taskCenterWorkspaceId,
      ]),
      activeTheme,
      isThemeWorkbench: contextHarnessRuntime.isThemeWorkbench,
      hasPendingA2UIForm,
      layoutMode,
      showChatPanel: effectiveShowChatPanel,
      showSidebar,
      defaultTopicSidebarVisible,
      hasMessages,
      canvasWorkbenchLayoutMode,
      autoCollapsedTopicSidebarRef,
      mappedTheme,
      normalizedEntryTheme: scope.normalizedInitialTheme,
      shouldPreserveBlankHomeSurface,
      shouldBootstrapCanvasOnEntry,
      canvasState,
      generalCanvasState,
      hasCurrentCanvasArtifact: Boolean(currentCanvasArtifact),
      currentImageWorkbenchActive:
        imageWorkbenchSessionRuntime.currentImageWorkbenchState.active,
      onHasMessagesChange,
      setShowSidebar,
      setLayoutMode,
      setGeneralCanvasState,
      setCanvasState,
      setCanvasWorkbenchLayoutMode,
    },
    selection: {
      activeTheme,
      contentId,
      setSelectedText,
    },
    taskFileSync: {
      taskFiles,
      isThemeWorkbench: contextHarnessRuntime.isThemeWorkbench,
      selectedFileId,
      canvasState,
      mappedTheme,
      documentEditorFocusedRef,
      setSelectedFileId,
      setCanvasState,
    },
  });

  const taskCenterInteractionRuntime = useWorkspaceTaskCenterInteractionRuntime(
    {
      composerDraftCoordinator: scope.composerDraftCoordinator,
      getComposerDraftNavigationEpoch: scope.getComposerDraftNavigationEpoch,
      chromeNavigation: {
        agentEntry,
        clearEmbeddedHomeSession: clearTaskCenterEmbeddedHomeSession,
        detachedTopicId: taskCenterDetachedTopicId,
        displayMessageCount: displayMessages.length,
        draftSendRequest: taskCenterDraftSendRequest,
        draftSurfaceActive: taskCenterHomeSurfaceActiveRef.current,
        embeddedHomeSessionIds: taskCenterEmbeddedHomeSessionIds,
        fallbackRestoreRef: taskCenterFallbackRestoreRef,
        hasDisplayMessages,
        hasLocalSessionOverride: taskCenterLocalSessionOverride !== null,
        hasPendingA2UIForm,
        harnessPanelVisible,
        initialDispatchKey,
        initialPendingServiceSkillLaunchSignature,
        isAutoRestoringSession,
        isBootstrapDispatchPending,
        isHomeSessionBackgroundRecovery:
          sessionRestorePresentation === "background" &&
          !normalizedInitialSessionId,
        isHomePendingPreviewActive,
        isHomeSendStarting,
        isPreparingSend,
        isSending,
        isSessionHydrating: scope.isSessionHydrating,
        messagesLength: messages.length,
        normalizedInitialSessionId,
        openTabIds: taskCenterOpenTabIds,
        queuedTurnsLength: queuedTurnCount,
        sessionId,
        setHarnessPanelVisible,
        shouldSuppressDraftContent: shouldSuppressTaskCenterDraftContent,
        shouldUseBrowserWorkspaceHomeChrome,
        taskCenterWorkspaceId,
        threadItemCount: effectiveThreadItems.length,
        topicById,
        topics,
        transitionTopicId: taskCenterTransitionTopicId,
      },
      taskCenterSurface: {
        isTaskCenterDraftSurfaceActive,
      },
      topicNavigation: {
        activeSessionIdRef,
        agentEntry,
        clearEntryPendingA2UI,
        clearTaskCenterEmbeddedHomeSession,
        messagesLength: messages.length,
        replaceTaskCenterOpenTabs,
        resetLocalImageWorkbenchSessionScope,
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
      },
    },
  );

  return {
    ...shellViewModel,
    ...canvasSurfaceRuntime,
    ...taskCenterSurfaceRuntime,
    ...taskCenterInteractionRuntime,
    hasCanvasWorkbenchContent,
  };
}
