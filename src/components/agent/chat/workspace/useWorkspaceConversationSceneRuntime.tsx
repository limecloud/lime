import type { Dispatch, SetStateAction } from "react";
import { useWorkspaceConversationScenePresentation } from "./useWorkspaceConversationScenePresentation";
import { useWorkspaceConversationSendRuntime } from "./useWorkspaceConversationSendRuntime";
import { useWorkspaceNavigationActions } from "./useWorkspaceNavigationActions";
import { useWorkspaceInputbarSceneRuntime } from "./useWorkspaceInputbarSceneRuntime";
import { useWorkspaceCanvasSceneRuntime } from "./useWorkspaceCanvasSceneRuntime";
import { useWorkspaceShellChromeRuntime } from "./useWorkspaceShellChromeRuntime";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { CreationMode } from "../components/types";
import type { WriteArtifactContext } from "../types";
import type { PendingA2UISource } from "../types";
import type { LayoutMode, ThemeType } from "@/lib/workspace/workbenchContract";
import type { Artifact } from "@/lib/artifact/types";
import type { Character } from "@/lib/api/memory";
import type { TaskFile } from "../components/TaskFiles";
import type { WorkspacePathMissingState } from "../hooks/agentChatShared";
import type { ArtifactTimelineOpenTarget } from "../utils/artifactTimelineNavigation";

type NavigationActions = ReturnType<typeof useWorkspaceNavigationActions>;
type InputbarScene = ReturnType<typeof useWorkspaceInputbarSceneRuntime>;
type CanvasScene = ReturnType<typeof useWorkspaceCanvasSceneRuntime>;
type ConversationSendRuntime = ReturnType<
  typeof useWorkspaceConversationSendRuntime
>;
type ShellChromeRuntime = ReturnType<typeof useWorkspaceShellChromeRuntime>;
type ConversationScenePresentationParams = Parameters<
  typeof useWorkspaceConversationScenePresentation
>[0];

interface UseWorkspaceConversationSceneRuntimeParams {
  navigationActions: NavigationActions;
  inputbarScene: InputbarScene;
  canvasScene: CanvasScene;
  conversationSendRuntime: ConversationSendRuntime;
  shellChromeRuntime: ShellChromeRuntime;
  themeWorkbenchHarnessDialog: ConversationScenePresentationParams["scene"]["themeWorkbenchHarnessDialog"];
  entryBannerVisible: ConversationScenePresentationParams["scene"]["entryBannerVisible"];
  entryBannerMessage: ConversationScenePresentationParams["scene"]["entryBannerMessage"];
  serviceSkillExecutionCard?: ConversationScenePresentationParams["scene"]["serviceSkillExecutionCard"];
  contextWorkspaceEnabled: boolean;
  input: ConversationScenePresentationParams["scene"]["input"];
  setInput: ConversationScenePresentationParams["scene"]["setInput"];
  providerType: ConversationScenePresentationParams["scene"]["providerType"];
  setProviderType: ConversationScenePresentationParams["scene"]["setProviderType"];
  model: ConversationScenePresentationParams["scene"]["model"];
  setModel: ConversationScenePresentationParams["scene"]["setModel"];
  executionStrategy: ConversationScenePresentationParams["scene"]["executionStrategy"];
  setExecutionStrategy: ConversationScenePresentationParams["scene"]["setExecutionStrategy"];
  accessMode: ConversationScenePresentationParams["scene"]["accessMode"];
  setAccessMode: ConversationScenePresentationParams["scene"]["setAccessMode"];
  chatToolPreferences: ChatToolPreferences;
  setChatToolPreferences: Dispatch<SetStateAction<ChatToolPreferences>>;
  selectedTeam: ConversationScenePresentationParams["scene"]["selectedTeam"];
  handleSelectTeam: ConversationScenePresentationParams["scene"]["onSelectTeam"];
  handleEnableSuggestedTeam: ConversationScenePresentationParams["scene"]["onEnableSuggestedTeam"];
  creationMode: CreationMode;
  setCreationMode: Dispatch<SetStateAction<CreationMode>>;
  activeTheme: string;
  setActiveTheme: Dispatch<SetStateAction<string>>;
  lockTheme: boolean;
  artifacts: Artifact[];
  generalCanvasContent: string;
  resolvedCanvasState: ConversationScenePresentationParams["scene"]["resolvedCanvasState"];
  contentId: ConversationScenePresentationParams["scene"]["contentId"];
  selectedText: ConversationScenePresentationParams["scene"]["selectedText"];
  handleRecommendationClick: ConversationScenePresentationParams["scene"]["onRecommendationClick"];
  projectCharacters: Character[];
  skills: ConversationScenePresentationParams["scene"]["skills"];
  skillsLoading: ConversationScenePresentationParams["scene"]["isSkillsLoading"];
  handleNavigateToSkillSettings: ConversationScenePresentationParams["scene"]["onNavigateToSettings"];
  handleRefreshSkills: ConversationScenePresentationParams["scene"]["onRefreshSkills"];
  handleOpenBrowserAssistInCanvas: ConversationScenePresentationParams["scene"]["onLaunchBrowserAssist"];
  browserAssistLaunching: ConversationScenePresentationParams["scene"]["browserAssistLoading"];
  projectId: string | null;
  hideHistoryToggle: boolean;
  showChatPanel: boolean;
  topBarChrome: ConversationScenePresentationParams["scene"]["navbarChrome"];
  onBackToProjectManagement?: ConversationScenePresentationParams["scene"]["onBackToProjectManagement"];
  fromResources: boolean;
  handleBackHome: ConversationScenePresentationParams["scene"]["onBackHome"];
  handleToggleSidebar: ConversationScenePresentationParams["scene"]["onToggleHistory"];
  chatMode: ConversationScenePresentationParams["scene"]["chatMode"];
  isBrowserAssistCanvasVisible: ConversationScenePresentationParams["scene"]["isBrowserAssistCanvasVisible"];
  browserAssistAttentionLevel: ConversationScenePresentationParams["scene"]["browserAssistAttentionLevel"];
  browserAssistEntryLabel: ConversationScenePresentationParams["scene"]["browserAssistLabel"];
  showHarnessToggle: ConversationScenePresentationParams["scene"]["showHarnessToggle"];
  navbarHarnessPanelVisible: ConversationScenePresentationParams["scene"]["harnessPanelVisible"];
  handleToggleHarnessPanel: ConversationScenePresentationParams["scene"]["onToggleHarnessPanel"];
  harnessPendingCount: ConversationScenePresentationParams["scene"]["harnessPendingCount"];
  harnessAttentionLevel: ConversationScenePresentationParams["scene"]["harnessAttentionLevel"];
  sessionId: string | null | undefined;
  syncStatus: ConversationScenePresentationParams["scene"]["syncStatus"];
  pendingA2UIForm: ConversationScenePresentationParams["scene"]["pendingA2UIForm"];
  pendingA2UISource: PendingA2UISource | null;
  a2uiSubmissionNotice: ConversationScenePresentationParams["scene"]["a2uiSubmissionNotice"];
  handlePendingA2UISubmit: NonNullable<
    ConversationScenePresentationParams["scene"]["onPendingA2UISubmit"]
  >;
  handleToggleCanvas: ConversationScenePresentationParams["scene"]["onToggleCanvas"];
  currentImageWorkbenchActive: ConversationScenePresentationParams["scene"]["currentImageWorkbenchActive"];
  hideInlineStepProgress: ConversationScenePresentationParams["stepProgress"]["hidden"];
  isSpecializedThemeMode: ConversationScenePresentationParams["stepProgress"]["isSpecializedThemeMode"];
  hasMessages: ConversationScenePresentationParams["stepProgress"]["hasMessages"];
  steps: ConversationScenePresentationParams["stepProgress"]["steps"];
  currentStepIndex: ConversationScenePresentationParams["stepProgress"]["currentIndex"];
  goToStep: ConversationScenePresentationParams["stepProgress"]["onStepClick"];
  displayMessages: ConversationScenePresentationParams["messageList"]["messages"];
  turns: ConversationScenePresentationParams["messageList"]["turns"];
  effectiveThreadItems: ConversationScenePresentationParams["messageList"]["threadItems"];
  currentTurnId: ConversationScenePresentationParams["messageList"]["currentTurnId"];
  threadRead: ConversationScenePresentationParams["messageList"]["threadRead"];
  pendingActions: ConversationScenePresentationParams["messageList"]["pendingActions"];
  submittedActionsInFlight: ConversationScenePresentationParams["messageList"]["submittedActionsInFlight"];
  queuedTurns: ConversationScenePresentationParams["messageList"]["queuedTurns"];
  isSending: ConversationScenePresentationParams["messageList"]["isSending"];
  stopSending: ConversationScenePresentationParams["messageList"]["onInterruptCurrentTurn"];
  resumeThread: ConversationScenePresentationParams["messageList"]["onResumeThread"];
  replayPendingAction: ConversationScenePresentationParams["messageList"]["onReplayPendingRequest"];
  promoteQueuedTurn: ConversationScenePresentationParams["messageList"]["onPromoteQueuedTurn"];
  deleteMessage: ConversationScenePresentationParams["messageList"]["onDeleteMessage"];
  editMessage: ConversationScenePresentationParams["messageList"]["onEditMessage"];
  handleA2UISubmit: ConversationScenePresentationParams["messageList"]["onA2UISubmit"];
  handleWriteFile: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void | Promise<void>;
  handleFileClick: ConversationScenePresentationParams["messageList"]["onFileClick"];
  handleOpenArtifactFromTimeline: (
    target: ArtifactTimelineOpenTarget,
  ) => void;
  handleOpenSavedSiteContent: ConversationScenePresentationParams["messageList"]["onOpenSavedSiteContent"];
  handleArtifactClick: ConversationScenePresentationParams["messageList"]["onArtifactClick"];
  handleOpenSubagentSession: ConversationScenePresentationParams["messageList"]["onOpenSubagentSession"];
  handlePermissionResponseWithBrowserPreflight: ConversationScenePresentationParams["messageList"]["onPermissionResponse"];
  pendingPromotedA2UIActionRequest: unknown;
  shouldCollapseCodeBlocks: ConversationScenePresentationParams["messageList"]["collapseCodeBlocks"];
  shouldCollapseCodeBlockInChat: ConversationScenePresentationParams["messageList"]["shouldCollapseCodeBlock"];
  handleCodeBlockClick: ConversationScenePresentationParams["messageList"]["onCodeBlockClick"];
  showTeamWorkspaceBoard: ConversationScenePresentationParams["teamWorkspaceDock"]["enabled"];
  layoutMode: LayoutMode;
  handleActivateTeamWorkbench: ConversationScenePresentationParams["teamWorkspaceDock"]["onActivateWorkbench"];
  isThemeWorkbench: boolean;
  settledWorkbenchArtifacts: ConversationScenePresentationParams["canvasWorkbenchLayout"]["artifacts"];
  taskFiles: TaskFile[];
  selectedFileId: string | undefined;
  projectRootPath: string | null;
  handleHarnessLoadFilePreview: ConversationScenePresentationParams["canvasWorkbenchLayout"]["loadFilePreview"];
  setCanvasWorkbenchLayoutMode: ConversationScenePresentationParams["canvasWorkbenchLayout"]["onLayoutModeChange"];
  workspacePathMissing: WorkspacePathMissingState | boolean | null;
  workspaceHealthError: boolean;
  focusedTimelineItemId: string | null;
  timelineFocusRequestKey: number;
}

export function useWorkspaceConversationSceneRuntime({
  navigationActions,
  inputbarScene,
  canvasScene,
  conversationSendRuntime,
  shellChromeRuntime,
  themeWorkbenchHarnessDialog,
  entryBannerVisible,
  entryBannerMessage,
  serviceSkillExecutionCard,
  contextWorkspaceEnabled,
  input,
  setInput,
  providerType,
  setProviderType,
  model,
  setModel,
  executionStrategy,
  setExecutionStrategy,
  accessMode,
  setAccessMode,
  chatToolPreferences,
  setChatToolPreferences,
  selectedTeam,
  handleSelectTeam,
  handleEnableSuggestedTeam,
  creationMode,
  setCreationMode,
  activeTheme,
  setActiveTheme,
  lockTheme,
  artifacts,
  generalCanvasContent,
  resolvedCanvasState,
  contentId,
  selectedText,
  handleRecommendationClick,
  projectCharacters,
  skills,
  skillsLoading,
  handleNavigateToSkillSettings,
  handleRefreshSkills,
  handleOpenBrowserAssistInCanvas,
  browserAssistLaunching,
  projectId,
  hideHistoryToggle,
  showChatPanel,
  topBarChrome,
  onBackToProjectManagement,
  fromResources,
  handleBackHome,
  handleToggleSidebar,
  chatMode,
  isBrowserAssistCanvasVisible,
  browserAssistAttentionLevel,
  browserAssistEntryLabel,
  showHarnessToggle,
  navbarHarnessPanelVisible,
  handleToggleHarnessPanel,
  harnessPendingCount,
  harnessAttentionLevel,
  sessionId,
  syncStatus,
  pendingA2UIForm,
  pendingA2UISource,
  a2uiSubmissionNotice,
  handlePendingA2UISubmit,
  handleToggleCanvas,
  currentImageWorkbenchActive,
  hideInlineStepProgress,
  isSpecializedThemeMode,
  hasMessages,
  steps,
  currentStepIndex,
  goToStep,
  displayMessages,
  turns,
  effectiveThreadItems,
  currentTurnId,
  threadRead,
  pendingActions,
  submittedActionsInFlight,
  queuedTurns,
  isSending,
  stopSending,
  resumeThread,
  replayPendingAction,
  promoteQueuedTurn,
  deleteMessage,
  editMessage,
  handleA2UISubmit,
  handleWriteFile,
  handleFileClick,
  handleOpenArtifactFromTimeline,
  handleOpenSavedSiteContent,
  handleArtifactClick,
  handleOpenSubagentSession,
  handlePermissionResponseWithBrowserPreflight,
  pendingPromotedA2UIActionRequest,
  shouldCollapseCodeBlocks,
  shouldCollapseCodeBlockInChat,
  handleCodeBlockClick,
  showTeamWorkspaceBoard,
  layoutMode,
  handleActivateTeamWorkbench,
  isThemeWorkbench,
  settledWorkbenchArtifacts,
  taskFiles,
  selectedFileId,
  projectRootPath,
  handleHarnessLoadFilePreview,
  setCanvasWorkbenchLayoutMode,
  workspacePathMissing,
  workspaceHealthError,
  focusedTimelineItemId,
  timelineFocusRequestKey,
}: UseWorkspaceConversationSceneRuntimeParams) {
  const handleQuoteMessage = (content: string) => {
    const normalized = content.trim();
    if (!normalized) {
      return;
    }

    const quotedBlock = `${normalized
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`;

    if (!input.trim()) {
      setInput(quotedBlock);
      return;
    }

    setInput(`${input.trimEnd()}\n\n${quotedBlock}`);
  };

  const teamWorkspaceDockLayoutMode =
    layoutMode === "chat" ? "chat" : "chat-canvas";

  return useWorkspaceConversationScenePresentation({
    scene: {
      entryBannerVisible,
      entryBannerMessage,
      onDismissEntryBanner: navigationActions.handleDismissEntryBanner,
      serviceSkillExecutionCard,
      showChatLayout: shellChromeRuntime.showChatLayout,
      compactChrome: shellChromeRuntime.isWorkspaceCompactChrome,
      contextWorkspaceEnabled,
      themeWorkbenchMessageViewportBottomPadding:
        shellChromeRuntime.themeWorkbenchLayoutBottomSpacing.messageViewportBottomPadding,
      onSelectWorkspaceDirectory:
        navigationActions.handleWorkspaceAlertSelectDirectory,
      onDismissWorkspaceAlert: navigationActions.handleDismissWorkspaceAlert,
      shouldHideThemeWorkbenchInputForTheme:
        shellChromeRuntime.shouldHideThemeWorkbenchInputForTheme,
      inputbarNode: inputbarScene.inputbarNode,
      input,
      setInput,
      onSendMessage: conversationSendRuntime.handleSendFromEmptyState,
      providerType,
      setProviderType,
      model,
      setModel,
      executionStrategy,
      setExecutionStrategy,
      accessMode,
      setAccessMode,
      onManageProviders: navigationActions.handleManageProviders,
      toolPreferences: chatToolPreferences,
      onToolPreferenceChange: (key, enabled) =>
        setChatToolPreferences((previous) => ({
          ...previous,
          [key]: enabled,
        })),
      selectedTeam,
      onSelectTeam: handleSelectTeam,
      onEnableSuggestedTeam: handleEnableSuggestedTeam,
      creationMode,
      onCreationModeChange: setCreationMode,
      activeTheme: activeTheme as ThemeType,
      onThemeChange: setActiveTheme,
      themeLocked: lockTheme,
      artifactsCount: artifacts.length,
      generalCanvasContent,
      resolvedCanvasState,
      contentId,
      selectedText,
      onRecommendationClick: handleRecommendationClick,
      characters: projectCharacters,
      skills,
      isSkillsLoading: skillsLoading,
      onNavigateToSettings: handleNavigateToSkillSettings,
      onRefreshSkills: handleRefreshSkills,
      onLaunchBrowserAssist: handleOpenBrowserAssistInCanvas,
      browserAssistLoading: browserAssistLaunching,
      projectId,
      onProjectChange: navigationActions.handleProjectChange,
      onOpenSettings: navigationActions.handleOpenAppearanceSettings,
      navbarVisible: shellChromeRuntime.shouldRenderTopBar,
      isRunning: Boolean(isSending),
      navbarChrome: topBarChrome,
      onToggleHistory: handleToggleSidebar,
      showHistoryToggle: !hideHistoryToggle && showChatPanel,
      onBackToProjectManagement,
      onBackToResources: fromResources
        ? navigationActions.handleBackToResources
        : undefined,
      isThemeWorkbench,
      layoutMode,
      onToggleCanvas: handleToggleCanvas,
      onBackHome: handleBackHome,
      chatMode,
      isBrowserAssistCanvasVisible,
      browserAssistAttentionLevel,
      browserAssistLabel: browserAssistEntryLabel,
      onOpenBrowserAssist: handleOpenBrowserAssistInCanvas,
      showHarnessToggle,
      harnessPanelVisible: navbarHarnessPanelVisible,
      onToggleHarnessPanel: handleToggleHarnessPanel,
      harnessPendingCount,
      harnessAttentionLevel,
      showContextCompactionAction: Boolean(sessionId),
      contextCompactionRunning: isSending,
      onCompactContext: navigationActions.handleCompactContext,
      syncStatus,
      pendingA2UIForm,
      onPendingA2UISubmit: handlePendingA2UISubmit,
      a2uiSubmissionNotice,
      hasLiveCanvasPreviewContent: canvasScene.hasLiveCanvasPreviewContent,
      liveCanvasPreview: canvasScene.liveCanvasPreview,
      currentImageWorkbenchActive,
      shouldShowCanvasLoadingState: canvasScene.shouldShowCanvasLoadingState,
      teamWorkbenchView: canvasScene.teamWorkbenchView,
      shellBottomInset:
        shellChromeRuntime.themeWorkbenchLayoutBottomSpacing.shellBottomInset,
      chatPanelWidth: shellChromeRuntime.layoutTransitionChatPanelWidth,
      chatPanelMinWidth: shellChromeRuntime.layoutTransitionChatPanelMinWidth,
      generalWorkbenchDialog: inputbarScene.generalWorkbenchDialog,
      themeWorkbenchHarnessDialog,
      showFloatingInputOverlay:
        shellChromeRuntime.shouldShowThemeWorkbenchFloatingInputOverlay,
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
      messages: displayMessages,
      turns,
      threadItems: effectiveThreadItems,
      currentTurnId,
      threadRead,
      pendingActions,
      submittedActionsInFlight,
      queuedTurns,
      isSending,
      onInterruptCurrentTurn: stopSending,
      onResumeThread: resumeThread,
      onReplayPendingRequest: replayPendingAction,
      onPromoteQueuedTurn: promoteQueuedTurn,
      onDeleteMessage: deleteMessage,
      onEditMessage: editMessage,
      onQuoteMessage: handleQuoteMessage,
      onA2UISubmit: handleA2UISubmit,
      onWriteFile: handleWriteFile,
      onFileClick: handleFileClick,
      onOpenArtifactFromTimeline: handleOpenArtifactFromTimeline,
      onOpenSavedSiteContent: handleOpenSavedSiteContent,
      onArtifactClick: handleArtifactClick,
      onOpenSubagentSession: handleOpenSubagentSession,
      onPermissionResponse: handlePermissionResponseWithBrowserPreflight,
      promoteActionRequestsToA2UI: Boolean(pendingPromotedA2UIActionRequest),
      renderA2UIInline: shellChromeRuntime.shouldRenderInlineA2UI,
      activePendingA2UISource: pendingA2UISource,
      collapseCodeBlocks: shouldCollapseCodeBlocks,
      shouldCollapseCodeBlock: shouldCollapseCodeBlockInChat,
      onCodeBlockClick: handleCodeBlockClick,
      focusedTimelineItemId,
      timelineFocusRequestKey,
    },
    teamWorkspaceDock: {
      enabled: showTeamWorkspaceBoard,
      shouldShowFloatingInputOverlay:
        shellChromeRuntime.shouldShowThemeWorkbenchFloatingInputOverlay,
      layoutMode: teamWorkspaceDockLayoutMode,
      onActivateWorkbench: handleActivateTeamWorkbench,
      withBottomOverlay:
        isThemeWorkbench &&
        shellChromeRuntime.showChatLayout &&
        !shellChromeRuntime.shouldHideThemeWorkbenchInputForTheme,
      surfaceProps: inputbarScene.teamWorkbenchSurfaceProps,
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
      workspaceRoot: projectRootPath,
      defaultPreview: canvasScene.canvasWorkbenchDefaultPreview,
      loadFilePreview: handleHarnessLoadFilePreview,
      onOpenPath: canvasScene.handleOpenCanvasWorkbenchPath,
      onRevealPath: canvasScene.handleRevealCanvasWorkbenchPath,
      renderPreview: canvasScene.renderCanvasWorkbenchPreview,
      onLayoutModeChange: setCanvasWorkbenchLayoutMode,
    },
  });
}
