/** Workspace scene/projection current owner。 */

import { useCallback } from "react";
import { ComposerModeContext } from "./ComposerModeContext";
import { ArtifactCommentSubmissionContext } from "@/components/artifact/ArtifactCommentSubmissionContext";
import { useWorkspaceArtifactCommentSubmission } from "./useWorkspaceArtifactCommentSubmission";
import { BrowserAnnotationContext } from "./right-surface/browser/BrowserAnnotationContext";
import { useWorkspaceCanvasSceneRuntime } from "./useWorkspaceCanvasSceneRuntime";
import { useWorkspaceInputbarSceneRuntime } from "./useWorkspaceInputbarSceneRuntime";
import { useWorkspaceTaskCenterSendRuntime } from "./useWorkspaceTaskCenterSendRuntime";
import { ScheduledTaskDialog } from "@/components/scheduled-tasks/ScheduledTaskDialog";
import {
  EMPTY_WORKSPACE_WORKFLOW_STEPS,
  HIDDEN_WORKSPACE_WORKFLOW_STEP_INDEX,
  ignoreHiddenWorkspaceWorkflowStepClick,
} from "./useWorkspaceHiddenWorkflowProgressRuntime";
import { useAgentChatWorkspaceSceneComposition } from "./useAgentChatWorkspaceSceneComposition";
import { buildThreadWorkspaceHeaderViewModel } from "./threadWorkspaceHeaderViewModel";
import type { AgentChatWorkspaceProps } from "../agentChatWorkspaceContract";
import type { useAgentChatWorkspaceEntryRuntime } from "./useAgentChatWorkspaceEntryRuntime";
import type { useAgentChatWorkspaceSetupRuntime } from "./useAgentChatWorkspaceSetupRuntime";
import type { useAgentChatWorkspaceCommandRuntime } from "./useAgentChatWorkspaceCommandRuntime";

type EntryRuntime = ReturnType<typeof useAgentChatWorkspaceEntryRuntime>;
type SetupRuntime = ReturnType<typeof useAgentChatWorkspaceSetupRuntime>;
type CommandRuntime = ReturnType<typeof useAgentChatWorkspaceCommandRuntime>;

interface UseAgentChatWorkspaceSceneRuntimeParams {
  props: AgentChatWorkspaceProps;
  entryRuntime: EntryRuntime;
  setupRuntime: SetupRuntime;
  commandRuntime: CommandRuntime;
}

export function useAgentChatWorkspaceSceneRuntime({
  props,
  entryRuntime,
  setupRuntime,
  commandRuntime,
}: UseAgentChatWorkspaceSceneRuntimeParams) {
  // prettier-ignore
  const {
    onNavigate: _onNavigate, contentId, agentEntry, fromResources, topBarChrome = "full", onBackToProjectManagement,
    hideInlineStepProgress, initialSessionName, initialKnowledgePackSelection, newChatAt, onBackgroundSessionRuntimeChange, preferContentReviewInRightRail,
  } = props;
  const resolvedAgentEntry = agentEntry ?? "claw";
  const resolvedFromResources = fromResources ?? false;
  const resolvedHideInlineStepProgress = hideInlineStepProgress ?? false;
  const resolvedPreferContentReviewInRightRail =
    preferContentReviewInRightRail ?? false;
  // prettier-ignore
  const {
    untitledTaskLabel, normalizedEntryTheme, shouldBootstrapCanvasOnEntry, activeTheme, artifactPreviewSize, effectiveEntryBannerMessage, entryBannerVisible,
    expertInfoPanelCollapsed, handleInputRestoreRequestHandled, input, composerController, inputbarObjectiveModeEnabled, inputRestoreRequest, layoutMode,
    setArtifactPreviewSize, setCanvasWorkbenchLayoutMode, setExpertInfoPanelCollapsed, setInput, setInputbarObjectiveModeEnabled, setLayoutMode, pathReferences,
    handleAddPathReferences, handleRemovePathReference, handleClearPathReferences,  activeSessionIdRef, setChatToolPreferences,
    handleOpenSkillsManageFromExpertPanel, projectId, markNewChatRequestHandled, taskCenterWorkspaceId, normalizedInitialSessionId, shouldUseBrowserWorkspaceHomeChrome, shouldDeferWorkspaceAuxiliaryLoads, project,
    isInitialContentLoading, initialContentLoadError, canvasState, setCanvasState, initialCreationReplaySurface, runtimeWorkspaceId, generalCanvasState,
    setGeneralCanvasState, taskFiles, selectedFileId, openedProjects, handleCloseOpenedProject, clawTraceEnabled, soulArtifactVoiceGenerationBrief, soulArtifactVoiceEnabledForTurn,
    setSoulArtifactVoiceEnabledForTurn, imageGenerationSelectionReady, imageGenerationSelectionWarning, imageWorkbenchGenerationRuntime, imageWorkbenchPreferenceSummary, imageWorkbenchPreferenceWarning,
    skills, serviceSkills, handleSkillSuggestionsNeeded, mappedTheme, syncStatus,
    isSpecializedThemeMode, workbenchRequests,
  } = entryRuntime;
  // prettier-ignore
  const {
    generalHarnessEntryEnabled, providerType, setProviderType, model, setModel, reasoningEffort, setReasoningEffort, accessMode,
    setAccessMode, messages, setChatMessages, currentTurnId, turns, todoItems,
    threadRead, threadGoal, threadGoalError, isThreadGoalLoading, executionRuntime, sessionWorkingDir, isSending, stopSending, replayPendingAction,
    deleteMessage, editMessage, handlePermissionResponse, submittedActionsInFlight, sessionHistoryWindow,
    isAutoRestoringSession, isSessionHydrating, sessionId, ensureSession, getThreadIdForSubmit, originalSwitchTopic, loadFullSessionHistory, refreshSessionReadModel, renameTopic, archiveTopic, forkTopic, workspacePathMissing, workspaceHealthError,
    combinedSkillsLoading, expertPanelRequestMetadata, expertPanelRuntimeKey, expertSkillRefsOverride, expertWorkspaceSkillRuntimeEnableBindings, expertWorkspaceSkillRuntimeEnableRefs, handleEnableExpertWorkspaceSkillRuntime, handleExpertSkillRefsChange,
    handlePluginSuggestionsNeeded, handleThreadExpertProfileSwitch, workspacePluginInputSuggestions, workspacePluginSuggestionsError, workspacePluginSuggestionsLoading, workspaceSkillBindings, topicById, effectiveChatToolPreferences, canonicalChildren,
    currentSessionTitle, handleStopSending, handleOpenSubagentSession, currentImageWorkbenchState, imageWorkbenchSessionKey, updateCurrentImageWorkbenchState, artifactDisplayState,
    artifactViewMode, currentCanvasArtifact, displayedCanvasArtifact, handleArtifactViewModeChange,
    settledWorkbenchArtifacts, contextHarnessRuntime, effectiveThreadItems, harnessState, inputbarIsSending, rightSurfaceLocalState, contextWorkspace,
    isThemeWorkbench, setHarnessPanelVisible, harnessPendingCount, showHarnessToggle, harnessAttentionLevel, harnessToggleLabel, generalWorkbenchScaffoldRuntime, workspaceServiceSkillEntryActions,
    a2uiSubmissionNotice, effectivePendingA2UIForm, effectivePendingA2UISource, handleMessageA2UISubmit, handlePendingA2UISubmit, currentGate, themeWorkbenchRunState,
  } = setupRuntime;
  // prettier-ignore
  const {
    composerMode, setComposerMode, composerDraftCoordinator, composerDraftStatus, composerDraftRestoring, handleComposerDraftAccepted, getComposerDraftNavigationEpoch,
    shellChromeRuntime, showGeneralWorkbenchLeftExpandButton, effectiveInitialInputCapability, generalWorkbenchHarnessPanelBaseProps, navigationActions, homePendingPreviewRequest, setHomePendingPreviewRequest,
    setTaskCenterDraftSendRequest, taskCenterDraftSendRequest, taskCenterHomeSurfaceActiveRef, generalWorkbenchEntryPrompt, handleBackHome, markTaskCenterLocalSessionOverride, setTaskCenterDetachedTopicId,
    setTaskCenterTransitionTopicId, upsertTaskCenterOpenTab, handleSend, handleSendRef, isPreparingSend, displayMessages, handleImageWorkbenchCommand,
    imageWorkbenchActionRuntime, handleContinueGeneralWorkbenchEntryPrompt, handleRestartGeneralWorkbenchEntryPrompt, handleDocumentAutoContinueRun, handleArtifactBlockRewriteRun, handleDocumentContentReviewRun, handleDocumentTextStylizeRun, handleAddImage,
    handleImportDocument, bootstrapPendingPreviewMessages, handleCanvasSelectionTextChange, handleCloseCanvas, bindBeforeCanvasLeave,
 handleToggleCanvas, hasDisplayMessages, hasMessages, homePendingPreviewMessages, isTaskCenterDraftSendPending, recentSessionTopic, resolvedCanvasState, shouldRenderTaskCenterEmbeddedHome, shouldRestoreImageTasksFromWorkspace, shouldSuppressTaskCenterDraftContent,
    suppressHomeNavbarUtilityActions, taskCenterHomeSurfaceState, bindArticleEditorRightSurface, bindRightSurfacePendingActions, handleCodeBlockClick,
    handleHarnessLoadFilePreview, handleOpenArtifactFromTimeline, handleOpenMessagePreview, handleOpenSavedSiteContent, handleOpenServiceSkillResultFile, handleOpenUrlPreview, handleSaveArtifactDocument, handleWorkspaceArtifactClick,
    handleWorkspaceFileClick, openWorkspaceArtifactInWorkbench, preferredServiceSkillResultFileTarget, renderArtifactWorkbenchToolbarActions, shouldCollapseCodeBlockInChat, shouldCollapseCodeBlocks, handleWriteFile,
    handleJumpToTimelineItem, serviceSkillExecutionCard, generalWorkbenchActivityLogs,
    generalWorkbenchWorkflowSteps, handleExpandGeneralWorkbenchSidebar, renderGeneralWorkbenchSidebarNode, planComposerPendingActions, planDecisionAccessory, handleSaveMessageAsSkill,
  } = commandRuntime;
  const inputbarScene = useWorkspaceInputbarSceneRuntime({
    contextVariant: agentEntry === "claw" ? "task-center" : "default",
    taskFiles,
    selectedFileId,
    isThemeWorkbench,
    sessionId,
    threadId: threadRead?.thread_id ?? null,
    canAcceptDirectInput: threadRead?.can_accept_direct_input,
    threadGoal,
    threadGoalError,
    threadGoalLoading: isThreadGoalLoading,
    generalWorkbenchHarnessPanelBaseProps,
    currentSessionTitle,
    handleStopSending,
    input,
    composerController,
    composerDraftCoordinator,
    onComposerDraftAccepted: handleComposerDraftAccepted,
    composerDraftStatus,
    composerDraftRestoring,
    setInput,
    currentGate,
    generalWorkbenchWorkflowSteps,
    steps: EMPTY_WORKSPACE_WORKFLOW_STEPS,
    workflowRunState: themeWorkbenchRunState,
    handleSend,
    sendMessage: setupRuntime.sendMessage,
    isPreparingSend,
    isSending: inputbarIsSending,
    isSessionRestoring:
      isAutoRestoringSession ||
      isSessionHydrating ||
      taskCenterHomeSurfaceState.isRestoringSession,
    providerType,
    setProviderType,
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    sessionExecutionRuntime: executionRuntime,
    projectId: projectId ?? null,
    projectRootPath: project?.rootPath || null,
    accessMode,
    setAccessMode,
    activeTheme,
    navigationActions,
    skills,
    skillsLoading: combinedSkillsLoading,
    onSkillSuggestionsNeeded: handleSkillSuggestionsNeeded,
    initialInputCapability: effectiveInitialInputCapability,
    initialKnowledgePackSelection,
    pluginSuggestions: workspacePluginInputSuggestions,
    pluginSuggestionsError: workspacePluginSuggestionsError?.message ?? null,
    pluginSuggestionsLoading: workspacePluginSuggestionsLoading,
    onPluginSuggestionsNeeded: handlePluginSuggestionsNeeded,
    setChatToolPreferences,
    objectiveEnabled: inputbarObjectiveModeEnabled,
    onObjectiveEnabledChange: setInputbarObjectiveModeEnabled,
    soulArtifactVoiceGenerationBrief,
    soulArtifactVoiceEnabledForTurn,
    onSoulArtifactVoiceEnabledForTurnChange: setSoulArtifactVoiceEnabledForTurn,
    generalWorkbenchEntryPrompt,
    handleRestartGeneralWorkbenchEntryPrompt,
    handleContinueGeneralWorkbenchEntryPrompt,
    planDecisionAccessory,
    generalWorkbenchEnabled:
      generalHarnessEntryEnabled && !suppressHomeNavbarUtilityActions,
    harnessPanelVisible:
      !suppressHomeNavbarUtilityActions &&
      contextHarnessRuntime.harnessPanelVisible,
    setHarnessPanelVisible: contextHarnessRuntime.setHarnessPanelVisible,
    harnessState,
    mappedTheme,
    activeRuntimeStatusTitle: contextHarnessRuntime.activeRuntimeStatusTitle,
    chatToolPreferences: effectiveChatToolPreferences,
    pathReferences,
    onAddPathReferences: handleAddPathReferences,
    inputRestoreRequest,
    onInputRestoreRequestHandled: handleInputRestoreRequestHandled,
    onRemovePathReference: handleRemovePathReference,
    onClearPathReferences: handleClearPathReferences,
  });

  const canvasScene = useWorkspaceCanvasSceneRuntime({
    shouldBootstrapCanvasOnEntry,
    normalizedEntryTheme,
    mappedTheme,
    canvasState,
    resolvedCanvasState,
    isInitialContentLoading,
    initialContentLoadError,
    imageWorkbenchGenerationRuntime,
    imageWorkbenchActionRuntime,
    inputbarScene,
    projectRootPath: project?.rootPath || null,
    generalCanvasState,
    setGeneralCanvasState,
    currentCanvasArtifact,
    displayedCanvasArtifact,
    artifactDisplayState,
    artifactViewMode,
    setArtifactViewMode: handleArtifactViewModeChange,
    artifactPreviewSize,
    setArtifactPreviewSize,
    onSaveArtifactDocument: handleSaveArtifactDocument,
    onArtifactBlockRewriteRun: handleArtifactBlockRewriteRun,
    renderArtifactWorkbenchToolbarActions,
    threadItems: effectiveThreadItems,
    focusedBlockId: workbenchRequests.focusedArtifactBlockId,
    blockFocusRequestKey: workbenchRequests.artifactBlockFocusRequestKey,
    onJumpToTimelineItem: handleJumpToTimelineItem,
    handleCloseCanvas,
    currentImageWorkbenchState,
    imageWorkbenchPreferenceSummary,
    imageWorkbenchPreferenceWarning,
    setCanvasState,
    handleBackHome,
    isSending,
    handleCanvasSelectionTextChange,
    projectId: projectId ?? null,
    contentId: contentId ?? null,
    imageGenerationSelectionReady,
    imageGenerationSelectionWarning,
    sourceThreadId: sessionId ?? null,
    providerType,
    setProviderType,
    model,
    setModel,
    handleDocumentAutoContinueRun,
    handleAddImage,
    handleImportDocument,
    handleDocumentContentReviewRun,
    handleDocumentTextStylizeRun,
    preferContentReviewInRightRail: resolvedPreferContentReviewInRightRail,
  });

  const taskCenterSendRuntime = useWorkspaceTaskCenterSendRuntime({
    composerDraftCoordinator,
    getComposerDraftNavigationEpoch,
    activeSessionIdRef,
    agentEntry: resolvedAgentEntry,
    currentSessionId: sessionId,
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
    messagesLength: messages.length,
    newChatAt,
    normalizedInitialSessionId,
    planComposerPendingActions,
    sendRef: handleSendRef,
    setDetachedTopicId: setTaskCenterDetachedTopicId,
    setHomePendingPreviewRequest,
    setInput,
    setTaskCenterDraftSendRequest,
    setTransitionTopicId: setTaskCenterTransitionTopicId,
    shouldRenderTaskCenterEmbeddedHome,
    shouldSuppressTaskCenterDraftContent,
    submittedActionsInFlight,
    taskCenterDraftSendRequest,
    taskCenterHomeSurfaceActiveRef,
    taskCenterHomeSurfaceState,
    taskCenterWorkspaceId,
    threadRead,
    turns,
    switchToReadySession: originalSwitchTopic,
    upsertTaskCenterOpenTab,
  });
  const {
    handleSendFromEmptyState,
    sceneDisplayMessages,
    sceneTurns,
    sceneThreadItems,
    sceneCurrentTurnId,
    sceneThreadRead,
    sceneExecutionRuntime,
    scenePendingActions,
    sceneSubmittedActionsInFlight,
    sceneIsPreparingSend,
    sceneIsSending,
    sceneIsRestoringSession,
    sceneLayoutMode,
    sceneMessageListEmptyStateVariant,
    sceneSessionId,
    shouldHideCurrentSessionContent,
  } = taskCenterSendRuntime;
  const ensureBrowserWorkspaceOwner = useCallback(async () => {
    const runtimeSessionId = (await ensureSession())?.trim();
    if (!runtimeSessionId) {
      return null;
    }
    let threadId = getThreadIdForSubmit(runtimeSessionId)?.trim();
    if (!threadId) {
      await refreshSessionReadModel();
      threadId = getThreadIdForSubmit(runtimeSessionId)?.trim();
    }
    return threadId ? { runtimeSessionId, threadId } : null;
  }, [ensureSession, getThreadIdForSubmit, refreshSessionReadModel]);
  const workspaceSceneNode = useAgentChatWorkspaceSceneComposition({
    expertPanel: {
      canOpenSkillsManage: Boolean(_onNavigate),
      combinedSkillsLoading,
      effectiveThreadItems,
      expertInfoPanelCollapsed,
      expertPanelRequestMetadata,
      expertPanelRuntimeKey,
      expertSkillRefsOverride,
      expertWorkspaceSkillRuntimeEnableBindings,
      expertWorkspaceSkillRuntimeEnableRefs,
      handleEnableExpertWorkspaceSkillRuntime,
      handleExpertSkillRefsChange,
      handleOpenSkillsManageFromExpertPanel,
      handleThreadExpertProfileSwitch,
      localSkills: skills,
      sceneLayoutMode,
      serviceSkills,
      setExpertInfoPanelCollapsed,
      workspaceSkillBindings,
    },
    rightSurface: {
      articleEditor: {
        activeArticleWorkspace: rightSurfaceLocalState.activeArticleWorkspace,
        canvasState,
        contentId,
        currentImageWorkbenchState,
        imageWorkbenchSessionKey,
        messages,
        projectId,
        runtimeWorkspaceId,
        sceneDisplayMessages,
        sceneIsPreparingSend,
        sceneIsSending,
        sceneSessionId,
        sceneThreadRead,
        setCanvasState,
        setChatMessages,
        shouldDeferWorkspaceAuxiliaryLoads,
        shouldHideCurrentSessionContent,
        shouldRestoreImageTasksFromWorkspace,
        updateCurrentImageWorkbenchState,
      },
      bindArticleEditorRightSurface,
      chrome: {
        showHarnessToggle,
        harnessPendingCount,
        harnessAttentionLevel,
        harnessToggleLabel,
        suppressHarnessChrome: suppressHomeNavbarUtilityActions,
      },
      coordinator: {
        bindRightSurfacePendingActions,
        clawTraceEnabled,
        expertInfoPanelCollapsed,
        handleToggleCanvas,
        harnessPendingCount,
        localState: rightSurfaceLocalState,
        preferredServiceSkillResultFileTarget,
        runtimeWorkspaceId,
        sceneIsPreparingSend,
        sceneIsSending,
        sceneLayoutMode,
        sceneSessionId,
        sceneThreadId: sceneThreadRead?.thread_id ?? null,
        sessionId,
        showHarnessToggle,
        suppressHomeNavbarUtilityActions,
        taskCenterHomeHotpathActive:
          shouldRenderTaskCenterEmbeddedHome ||
          Boolean(taskCenterDraftSendRequest || homePendingPreviewRequest),
        threadItems: sceneThreadItems,
        threadTurns: sceneThreadRead?.thread_turns ?? [],
        setExpertInfoPanelCollapsed,
        setHarnessPanelVisible,
        setLayoutMode,
      },
      host: {
        ensureBrowserWorkspaceOwner,
        generalWorkbenchHarnessPanelBaseProps,
        harnessState,
        preferredServiceSkillResultFileTarget,
        runtimeWorkspaceId,
        sceneSessionId,
        sceneThreadId: sceneThreadRead?.thread_id ?? null,
        onOpenArticlePreviewArtifact: openWorkspaceArtifactInWorkbench,
        onOpenServiceSkillResultFile: handleOpenServiceSkillResultFile,
        handleSendRef,
        restoreInput: setInput,
        setLayoutMode,
      },
      imageSlot: {
        contentId,
        handleImageWorkbenchCommand,
        projectId,
        setLayoutMode,
      },
      projectRootPath: project?.rootPath,
      renderGeneralWorkbenchSidebarNode,
      sessionWorkingDir,
    },
    backgroundSession: {
      onBackgroundSessionRuntimeChange,
      recentSessionTopic,
    },
    conversation: {
      landing: {
        accessMode,
        activeTheme,

        chatToolPreferences: effectiveChatToolPreferences,

        creationReplaySurface: initialCreationReplaySurface,
        emptyStateDisabled:
          sceneIsPreparingSend || sceneIsSending || composerDraftRestoring,
        emptyStateIsLoading: sceneIsPreparingSend || sceneIsSending,
        emptyStateSendOnPointerDown: true,
        entryBannerMessage: effectiveEntryBannerMessage,
        entryBannerVisible,

        handleSendFromEmptyState,
        initialInputCapability: effectiveInitialInputCapability,
        input,
        composerController,
        composerDraftCoordinator,
        onComposerDraftAccepted: handleComposerDraftAccepted,
        composerDraftStatus,
        composerDraftRestoring,
        inputRestoreRequest,
        model,
        objectiveEnabled: inputbarObjectiveModeEnabled,
        onAddPathReferences: handleAddPathReferences,
        onClearPathReferences: handleClearPathReferences,
        onDismissEntryBanner: navigationActions.handleDismissEntryBanner,
        onInputRestoreRequestHandled: handleInputRestoreRequestHandled,
        onManageProviders: navigationActions.handleManageProviders,
        onObjectiveEnabledChange: setInputbarObjectiveModeEnabled,
        onPluginSuggestionsNeeded: handlePluginSuggestionsNeeded,
        onProjectChange: navigationActions.handleProjectChange,
        onSkillSuggestionsNeeded: handleSkillSuggestionsNeeded,
        onRemovePathReference: handleRemovePathReference,
        onStopSending: stopSending,

        openedProjects,
        pathReferences,
        pluginSuggestions: workspacePluginInputSuggestions,
        pluginSuggestionsError:
          workspacePluginSuggestionsError?.message ?? null,
        pluginSuggestionsLoading: workspacePluginSuggestionsLoading,
        projectId: projectId ?? null,
        providerType,
        reasoningEffort,

        serviceSkillExecutionCard,
        sessionId: sceneSessionId,
        setAccessMode,
        setChatToolPreferences,
        setInput,
        setModel,
        setProviderType,
        setReasoningEffort,
        skills,
        skillsLoading: combinedSkillsLoading,
      },
      messageList: {
        actions: {
          onA2UISubmit: handleMessageA2UISubmit,
          onArtifactClick: handleWorkspaceArtifactClick,
          onCodeBlockClick: handleCodeBlockClick,
          onDeleteMessage: deleteMessage,
          onEditMessage: editMessage,
          onFileClick: handleWorkspaceFileClick,
          onInterruptCurrentTurn: stopSending,
          onLoadFullHistory: () => {
            void loadFullSessionHistory();
          },
          onOpenArtifactFromTimeline: handleOpenArtifactFromTimeline,
          onOpenMessagePreview: handleOpenMessagePreview,
          onOpenSavedSiteContent: handleOpenSavedSiteContent,
          onOpenSubagentSession: handleOpenSubagentSession,
          onOpenUrlPreview: handleOpenUrlPreview,
          onPermissionResponse: handlePermissionResponse,
          onReplayPendingRequest: replayPendingAction,

          onSaveMessageAsSkill: handleSaveMessageAsSkill,
          onWriteFile: handleWriteFile,
        },
        collapseCodeBlocks: shouldCollapseCodeBlocks,
        emptyStateVariant: sceneMessageListEmptyStateVariant,
        focus: {
          focusedTimelineItemId: workbenchRequests.focusedTimelineItemId,
          timelineFocusRequestKey: workbenchRequests.timelineFocusRequestKey,
        },
        input: {
          quoteInput: input,
          onQuoteInputChange: setInput,
        },
        projection: {
          currentTurnId: sceneCurrentTurnId,
          executionRuntime: sceneExecutionRuntime,
          isSending: sceneIsSending,
          pendingActions: scenePendingActions,
          sessionHistoryWindow,
          submittedActionsInFlight: sceneSubmittedActionsInFlight,
          threadItems: sceneThreadItems,
          threadRead: sceneThreadRead,
          todoItems,
          turns: sceneTurns,
        },
        provider: {
          accessMode,
          model,
          providerType,
          reasoningEffort,
        },
        refreshSessionReadModel,
        sceneSessionId,
        shouldCollapseCodeBlock: shouldCollapseCodeBlockInChat,
      },
      scene: {
        threadHeader: buildThreadWorkspaceHeaderViewModel({
          sessionId: sceneSessionId,
          currentSessionTitle,
          initialSessionId: normalizedInitialSessionId,
          initialSessionName,
          topic: sceneSessionId ? topicById.get(sceneSessionId) : null,
          onRename: sceneSessionId
            ? (nextTitle) => renameTopic(sceneSessionId, nextTitle)
            : undefined,
          onArchive: sceneSessionId
            ? async () => {
                const archived = await archiveTopic(sceneSessionId);
                if (archived) {
                  handleBackHome();
                }
              }
            : undefined,
          onFork: sceneSessionId
            ? async () => {
                const forkedSessionId = await forkTopic(sceneSessionId);
                if (forkedSessionId) {
                  await commandRuntime.handleOpenTaskTopic(forkedSessionId);
                }
              }
            : undefined,
          untitledTaskLabel,
        }),
        navbarContextVariant:
          agentEntry === "claw" || shouldUseBrowserWorkspaceHomeChrome
            ? "task-center"
            : "default",
        navigationActions,
        inputbarScene,
        canvasScene,
        shellChromeRuntime,
        currentImageWorkbenchActive: currentImageWorkbenchState.active,
        canvasWorkbenchPreviewOpenRequest:
          workbenchRequests.canvasWorkbenchPreviewOpenRequest,
        onCanvasWorkbenchPreviewOpenRequestHandled:
          workbenchRequests.handleCanvasWorkbenchPreviewOpenRequestHandled,
        projectId: projectId ?? null,
        openedProjects,
        onCloseProject: handleCloseOpenedProject,
        deferWorkspaceListLoad: shouldUseBrowserWorkspaceHomeChrome,
        projectRootPath: project?.rootPath || null,
        contextWorkspaceEnabled: contextWorkspace.generalWorkbenchEnabled,
        activeTheme,
        contentId,
        suppressNavbarUtilityActions: suppressHomeNavbarUtilityActions,
        topBarChrome,
        onBackToProjectManagement,
        fromResources: resolvedFromResources,
        handleBackHome,
        isRestoringSession: sceneIsRestoringSession,
        sessionId: sceneSessionId,
        threadGoal,
        syncStatus,
        pendingA2UIForm: effectivePendingA2UIForm,
        pendingA2UISource: effectivePendingA2UISource,
        a2uiSubmissionNotice,
        handlePendingA2UISubmit,
        hideInlineStepProgress: resolvedHideInlineStepProgress,
        isSpecializedThemeMode,
        hasMessages,
        steps: EMPTY_WORKSPACE_WORKFLOW_STEPS,
        activityLogs: generalWorkbenchActivityLogs,
        creationTaskEvents:
          generalWorkbenchScaffoldRuntime.generalWorkbenchCreationTaskEvents,
        canonicalChildren,
        currentStepIndex: HIDDEN_WORKSPACE_WORKFLOW_STEP_INDEX,
        goToStep: ignoreHiddenWorkspaceWorkflowStepClick,
        layoutMode: sceneLayoutMode,
        isThemeWorkbench,
        settledWorkbenchArtifacts,
        resolvedCanvasState,
        taskFiles,
        selectedFileId,
        handleHarnessLoadFilePreview,
        setCanvasWorkbenchLayoutMode,
        onBeforeCanvasLeaveChange: bindBeforeCanvasLeave,
        workspacePathMissing: Boolean(workspacePathMissing),
        workspaceHealthError,
      },
    },

    shell: {
      compactChrome: shellChromeRuntime.isWorkspaceCompactChrome,
      isThemeWorkbench,
      showGeneralWorkbenchLeftExpandButton,
      onExpandGeneralWorkbenchSidebar: handleExpandGeneralWorkbenchSidebar,
    },
  });
  const artifactCommentSubmission = useWorkspaceArtifactCommentSubmission({
    sessionId,
    threadId: threadRead?.thread_id,
    originatingTurnId: threadRead?.thread_turns?.at(-1)?.id ?? null,
    projectId,
    isSending,
    activeSessionIdRef,
    getNavigationEpoch: getComposerDraftNavigationEpoch,
    send: inputbarScene.handleInputbarSend,
    openFile: async (absolutePath, isCurrent) => {
      if (!isCurrent()) return false;
      rightSurfaceLocalState.openWorkspaceFile(absolutePath);
      return true;
    },
  });
  return (
    <ComposerModeContext.Provider value={{ composerMode, setComposerMode }}>
      <ArtifactCommentSubmissionContext.Provider
        value={artifactCommentSubmission}
      >
        <BrowserAnnotationContext.Provider
          value={sessionId && threadRead?.thread_id ? {
            sessionId,
            threadId: threadRead.thread_id,
            send: inputbarScene.handleInputbarSend,
            isSending,
            workspaceId: runtimeWorkspaceId ?? projectId ?? null,
          } : null}
        >
          {workspaceSceneNode}
        </BrowserAnnotationContext.Provider>
        <ScheduledTaskDialog
          open={workspaceServiceSkillEntryActions.automationDialogOpen}
          mode="create"
          initialForm={
            workspaceServiceSkillEntryActions.automationDialogInitialValues
          }
          saving={workspaceServiceSkillEntryActions.automationJobSaving}
          onOpenChange={
            workspaceServiceSkillEntryActions.handleAutomationDialogOpenChange
          }
          onSubmit={
            workspaceServiceSkillEntryActions.handleAutomationDialogSubmit
          }
        />
      </ArtifactCommentSubmissionContext.Provider>
    </ComposerModeContext.Provider>
  );
}
