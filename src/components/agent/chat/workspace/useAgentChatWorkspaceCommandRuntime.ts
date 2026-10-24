/** Workspace command/runtime current owner。 */

import { useMemo } from "react";

import {
  cancelMediaTaskArtifact,
  createImageGenerationTaskArtifact,
  getMediaTaskArtifact,
} from "@/lib/api/mediaTasks";
import { useWorkspaceNavigationActions } from "./useWorkspaceNavigationActions";
import { useWorkspaceWorkbenchSideEffectRuntime } from "./useWorkspaceWorkbenchSideEffectRuntime";
import { useWorkspaceShellChromeRuntime } from "./useWorkspaceShellChromeRuntime";
import { useWorkspaceGeneralWorkbenchSidebarHostRuntime } from "./useWorkspaceGeneralWorkbenchSidebarHostRuntime";
import { useWorkspaceHarnessNavigationRuntime } from "./useWorkspaceHarnessNavigationRuntime";
import { useWorkspaceGeneralWorkbenchHarnessSurfaceRuntime } from "./useWorkspaceGeneralWorkbenchHarnessSurfaceRuntime";
import { useWorkspaceMessageSkillSaveRuntime } from "./useWorkspaceMessageSkillSaveRuntime";
import { useWorkspaceHiddenWorkflowProgressRuntime } from "./useWorkspaceHiddenWorkflowProgressRuntime";
import { useWorkspacePlanDecisionRuntime } from "./useWorkspacePlanDecisionRuntime";
import { GENERAL_WORKBENCH_HISTORY_PAGE_SIZE } from "./generalWorkbenchHelpers";
import { useAgentChatWorkspaceCommandWiring } from "./useAgentChatWorkspaceCommandWiring";
import { useAgentChatWorkspaceShellInteractionRuntime } from "./useAgentChatWorkspaceShellInteractionRuntime";
import { useAgentChatWorkspaceArtifactInteractionRuntime } from "./useAgentChatWorkspaceArtifactInteractionRuntime";
import { resolveEffectiveInitialInputCapability } from "../utils/inputCapabilityBootstrap";
import type { AgentChatWorkspaceProps } from "../agentChatWorkspaceContract";
import type { useAgentChatWorkspaceEntryRuntime } from "./useAgentChatWorkspaceEntryRuntime";
import type { useAgentChatWorkspaceSetupRuntime } from "./useAgentChatWorkspaceSetupRuntime";

type EntryRuntime = ReturnType<typeof useAgentChatWorkspaceEntryRuntime>;
type SetupRuntime = ReturnType<typeof useAgentChatWorkspaceSetupRuntime>;

interface UseAgentChatWorkspaceCommandRuntimeParams {
  props: AgentChatWorkspaceProps;
  entryRuntime: EntryRuntime;
  setupRuntime: SetupRuntime;
}

export function useAgentChatWorkspaceCommandRuntime({
  props,
  entryRuntime,
  setupRuntime,
}: UseAgentChatWorkspaceCommandRuntimeParams) {
  // prettier-ignore
  const {
    onNavigate: _onNavigate, projectId: externalProjectId, contentId, initialSessionId, initialAutoSendRequestMetadata, autoRunInitialPromptOnMount, agentEntry,
    theme: initialTheme, initialCreationMode, lockTheme, showChatPanel, hideTopBar, topBarChrome, onWorkflowProgressChange, initialUserPrompt,
    initialUserImages, initialInputCapability, initialProjectFileOpenTarget, onInitialUserPromptConsumed, newChatAt, newConversationRequest, onStartNewConversation, onHasMessagesChange: _onHasMessagesChange,
  } = props;
  const resolvedAutoRunInitialPromptOnMount =
    autoRunInitialPromptOnMount ?? false;
  const resolvedAgentEntry = agentEntry ?? "claw";
  const resolvedLockTheme = lockTheme ?? false;
  const resolvedShowChatPanel = showChatPanel ?? true;
  const resolvedHideTopBar = hideTopBar ?? false;
  const resolvedTopBarChrome = topBarChrome ?? "full";
  // prettier-ignore
  const {
    t, untitledTaskLabel, normalizedEntryTheme, defaultTopicSidebarVisible, shouldBootstrapCanvasOnEntry,
    shouldKeepNewTaskHomeSessionRestoreDisabled, localDisplayRuntime, activeTheme, layoutMode, runtimeInitialInputCapability, setCanvasWorkbenchLayoutMode, setEntryBannerVisible, setExpertInfoPanelCollapsed,
    setInput, setLayoutMode, showSidebar, activeSessionIdRef, deferSessionRecentMetadataSyncForNavigation, setChatToolPreferences, projectSelectionRuntime,
    projectId, shouldDisableSessionRestore, applyProjectSelection, taskCenterWorkspaceId, normalizedInitialSessionId, sessionRestorePresentation, shouldPreserveBlankHomeSurface, shouldUseBrowserWorkspaceHomeChrome,
    shouldDeferWorkspaceAuxiliaryLoads, project, isInitialContentLoading, canvasState, setCanvasState, setDocumentVersionStatusMap, lastCanvasSyncRequestRef, initialAutoSendAllowsDetachedSession,
    initialCreationReplay, initialPendingServiceSkillLaunchSignature, validatedRuntimeProjectId, generalCanvasState, setGeneralCanvasState, taskFiles, setTaskFiles,
    selectedFileId, setSelectedFileId, taskFilesRef, socialStageLogRef, serviceModels, agentResponseLanguage, refreshServiceModelsConfig,
    soulArtifactVoiceGenerationBrief, soulInteractionCopy, soulArtifactVoiceEnabledForTurn, setSoulArtifactVoiceEnabledForTurn, effectiveImageWorkbenchPreference, imageWorkbenchGenerationRuntime, setOnDemandMediaDefaults, imageWorkbenchSelectedProviderId,
    imageWorkbenchSelectedModelId, imageWorkbenchSelectedSize, setImageWorkbenchSelectedSize, imageWorkbenchPreferredProviderUnavailable, ensureImageWorkbenchProvidersLoaded, imageWorkbenchProvidersLoading, mentionedCharacters,
    setMentionedCharacters, serviceSkills, pendingSkillKey, consumePendingSkill, processedMessageIds, handleWriteFileRef, sceneGateResumeHandlerRef, mappedTheme,
    syncContent, isSpecializedThemeMode, workbenchRequests,
  } = entryRuntime;
  // prettier-ignore
  const {
    systemPrompt, agentChatRuntime, providerType, model, executionStrategy, accessMode, messages, setChatMessages,
    currentTurnId, turns, threadItems, queuedTurnCount, threadRead, threadGoal, threadGoalError, isThreadGoalLoading, activeExecutionRuntime, isSending, compactSession, refreshSessionReadModel,
    stopSending, replayPendingAction, handlePermissionResponse, pendingActions, submittedActionsInFlight, triggerAIGuide,
    topics, isAutoRestoringSession, isSessionHydrating, sessionId, ensureSession, originalSwitchTopic, workspacePathMissing,
    fixWorkspacePathAndRetry, dismissWorkspacePathError, setWorkspaceHealthError, expertWorkspaceSkillRuntimeEnableInput, workspaceRequestMetadataWithExpertSkills, workspaceSkillBindings, topicById,
    autoCollapsedTopicSidebarRef, effectiveChatToolPreferences, canonicalChildren, hasRuntimeSessions, subagentsRuntimeVisible, handleOpenSubagentSession, imageWorkbenchSessionRuntime, currentImageWorkbenchState,
    imageWorkbenchSessionKey, updateCurrentImageWorkbenchState, artifactCanvasRuntime, artifacts, applyAutoArtifactViewMode,
    currentCanvasArtifact, setSelectedArtifactId, upsertGeneralArtifact,
    contextSurfaceRuntime, contextHarnessRuntime, effectiveThreadItems, harnessShellState, inputbarIsSending, openArticleWorkspaceRightSurface, isThemeWorkbench,
    setHarnessPanelVisible, generalWorkbenchScaffoldRuntime, shouldUseCompactGeneralWorkbench, shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt, setTopicStatus, clearEntryPendingA2UI, hasPendingA2UIForm,
    openRuntimeSceneGate, currentGate, documentEditorFocusedRef, themeWorkbenchActiveQueueItem, themeWorkbenchBackendRunState, themeWorkbenchRunState, harnessInventoryRuntime,
  } = setupRuntime;
  const commandWiring = useAgentChatWorkspaceCommandWiring({
    composerDraftTitle: untitledTaskLabel,
    navigationProjectId: validatedRuntimeProjectId ?? undefined,
    trayActiveTheme: mappedTheme,
    consumePendingSkill,
    pendingSkillKey,
    sceneGateResumeHandlerRef,
    scope: {
      ...agentChatRuntime,
      ...localDisplayRuntime,
      resetComposerDraft: entryRuntime.resetComposerDraft,
      ...projectSelectionRuntime,
      accessMode,
      agentResponseLanguage,
      agentEntry: resolvedAgentEntry,
      autoCollapsedTopicSidebarRef,
      autoRunInitialPromptOnMount: resolvedAutoRunInitialPromptOnMount,
      autoSyncEnabled: false,
      cancelImageTask: cancelMediaTaskArtifact,
      canvasState,
      chatToolPreferences: effectiveChatToolPreferences,
      clearPendingEntryA2UI: clearEntryPendingA2UI,
      contentId,
      createImageGenerationTask: createImageGenerationTaskArtifact,
      currentGateKey: currentGate.key,
      currentImageWorkbenchState,
      currentSessionId: sessionId,
      defaultTopicSidebarVisible,
      deferInitialSync: true,
      deferSessionRecentMetadataSyncForNavigation,
      effectiveThreadItemCount: threadItems.length,
      externalProjectId,
      getImageTask: getMediaTaskArtifact,
      hasInitialSessionTopic: normalizedInitialSessionId
        ? topicById.has(normalizedInitialSessionId)
        : false,
      initialCreationMode,
      initialSessionId,
      initialSessionMessagesCount: normalizedInitialSessionId
        ? (topicById.get(normalizedInitialSessionId)?.messagesCount ?? null)
        : null,
      initialTheme,
      initialUserImages,
      initialUserPrompt,
      isAutoRestoringSession,
      isSessionHydrating,
      isSpecializedThemeMode,
      isThemeWorkbench,
      imageWorkbenchPreferredModelId:
        effectiveImageWorkbenchPreference.preferredModelId,
      imageWorkbenchPreferredProviderId:
        effectiveImageWorkbenchPreference.preferredProviderId,
      imageWorkbenchPreferredProviderUnavailable,
      imageWorkbenchProvidersLoading,
      imageWorkbenchSelectedModelId,
      imageWorkbenchSelectedProviderId,
      imageWorkbenchSelectedSize,
      imageWorkbenchSessionKey,
      ensureImageWorkbenchProvidersLoaded,
      ensureSessionForCommandMetadata: ensureSession,
      executionStrategy,
      lastCanvasSyncRequestRef,
      lockTheme: resolvedLockTheme,
      mappedTheme,
      mentionedCharacters,
      messages,
      messagesLength: messages.length,
      newChatAt,
      newConversationRequest,
      onStartNewConversation,
      normalizedInitialSessionId,
      normalizedInitialTheme: normalizedEntryTheme,
      onInitialUserPromptConsumed,
      onNavigate: _onNavigate,
      openRuntimeSceneGate,
      originalSwitchTopic,
      preserveSessionRestoreOnNewChat:
        shouldKeepNewTaskHomeSessionRestoreDisabled &&
        !shouldDisableSessionRestore,
      processedMessageIdsRef: processedMessageIds,
      projectImageGenerationPreference: project?.settings?.imageGeneration,
      projectName: project?.name,
      projectRootPath: project?.rootPath || null,
      queuedTurnCount,
      queuedTurnsLength: queuedTurnCount,
      resolveServiceModelsBeforeSend: shouldDeferWorkspaceAuxiliaryLoads
        ? refreshServiceModelsConfig
        : undefined,
      savedSoulArtifactVoiceGenerationBrief: soulArtifactVoiceGenerationBrief,
      serviceModels,
      serviceSkills: activeTheme === "general" ? serviceSkills : [],
      setCanvasState,
      setDocumentVersionStatusMap,
      setChatMessages,
      setChatToolPreferences,
      setGeneralCanvasState,
      setMentionedCharacters,
      setOnDemandMediaDefaults,
      setSelectedFileId,
      setSoulArtifactVoiceEnabledForTurn,
      setTaskFiles,
      setTopicStatus,
      shouldUseCompactGeneralWorkbench,
      syncContent,
      taskCenterWorkspaceId,
      taskFilesLength: taskFiles.length,
      themeWorkbenchLatestTerminal:
        themeWorkbenchBackendRunState?.latest_terminal ?? null,
      themeWorkbenchRunState,
      themeWorkbenchActiveQueueTitle: themeWorkbenchActiveQueueItem?.title,
      threadItemsLength: threadItems.length,
      topicById,
      topics,
      turnsLength: turns.length,
      updateCurrentImageWorkbenchState,
      workspaceRequestMetadataBase:
        workspaceRequestMetadataWithExpertSkills ?? undefined,
      workspaceSkillBindings,
      workspaceSkillRuntimeEnable: expertWorkspaceSkillRuntimeEnableInput,
      soulArtifactVoiceEnabledForTurn,
    },
  });
  const {
    homePendingPreviewRequest,
    setHomePendingPreviewRequest,
    setTaskCenterDraftSendRequest,
    taskCenterDraftSendRequest,
    taskCenterHomeSurfaceActiveRef,
  } = commandWiring.taskCenterDraftState;
  const { readSessionFile, saveSessionFile, sessionFiles } =
    commandWiring.persistence;
  const {
    consumedInitialPromptRef,
    generalWorkbenchEntryCheckPending,
    generalWorkbenchEntryPrompt,
    hasTriggeredGuideRef,
    initialDispatchKey,
    isBootstrapDispatchPending,
  } = commandWiring.initialDispatch;
  const { handleBackHome } = commandWiring.reset;
  const {
    markTaskCenterLocalSessionOverride,
    setTaskCenterDetachedTopicId,
    setTaskCenterTransitionTopicId,
    upsertTaskCenterOpenTab,
  } = commandWiring.taskCenterNavigation;

  const {
    composerMode,
    setComposerMode,
    handleSend,
    handleSendRef,
    isPreparingSend,
    displayMessages,
    handleImageWorkbenchCommand,
    imageWorkbenchActionRuntime,
    latestAssistantMessageId,
  } = commandWiring.send;

  const {
    applyWorkbenchFollowUpActionPayload,
    handleContinueGeneralWorkbenchEntryPrompt,
    handleRestartGeneralWorkbenchEntryPrompt,
    handleDocumentAutoContinueRun,
    handleArtifactBlockRewriteRun,
    handleDocumentContentReviewRun,
    handleDocumentTextStylizeRun,
    handleSwitchBranchVersion,
    handleCreateVersionSnapshot,
    handleSetBranchStatus,
    handleAddImage,
    handleImportDocument,
  } = commandWiring.workbenchActions;

  const shellInteractionRuntime = useAgentChatWorkspaceShellInteractionRuntime({
    scope: commandWiring.compositionScope,
    localDisplayRuntime,
    contextSurfaceRuntime,
    artifactCanvasRuntime,
    imageWorkbenchSessionRuntime,
    documentEditorFocusedRef,
    soulInteractionCopy,
    activeSessionIdRef,
    agentEntry: resolvedAgentEntry,
    clearEntryPendingA2UI,
    generalCanvasState,
    hasPendingA2UIForm,
    initialPendingServiceSkillLaunchSignature,
    sessionRestorePresentation,
    selectedFileId,
    shouldBootstrapCanvasOnEntry,
    shouldPreserveBlankHomeSurface,
    shouldUseBrowserWorkspaceHomeChrome,
    showChatPanel: resolvedShowChatPanel,
    taskCenterWorkspaceId,
    taskFiles,
    onHasMessagesChange: _onHasMessagesChange,
  });
  const {
    bootstrapPendingPreviewMessages,
    effectiveShowChatPanel,
    handleCanvasSelectionTextChange,
    handleCloseCanvas,
    bindBeforeCanvasLeave,
    handleOpenTaskTopic,
    handleToggleCanvas,
    hasCanvasWorkbenchContent,
    hasDisplayMessages,
    hasHomeConversationActivity,
    hasMessages,
    homePendingPreviewMessages,
    isTaskCenterDraftSendPending,
    recentSessionTopic,
    resolvedCanvasState,
    shouldRenderTaskCenterEmbeddedHome,
    shouldRestoreImageTasksFromWorkspace,
    shouldSuppressTaskCenterDraftContent,
    suppressHomeNavbarUtilityActions,
    taskCenterHomeSurfaceState,
  } = shellInteractionRuntime;
  const artifactInteractionRuntime =
    useAgentChatWorkspaceArtifactInteractionRuntime({
      action: {
        activeTheme,
        artifacts,
        contentId,
        currentCanvasArtifact,
        currentGateKey: currentGate.key,
        currentTurnId,
        effectiveThreadItems,
        generalCanvasState,
        handleWriteFileRef,
        initialProjectFileOpenTarget,
        isInitialContentLoading,
        isThemeWorkbench,
        layoutMode,
        mappedTheme,
        messages,
        onNavigate: _onNavigate,
        openArticleWorkspaceRightSurface,
        openWorkspaceFile:
          contextSurfaceRuntime.rightSurfaceLocalState.openWorkspaceFile,
        projectId,
        projectRootPath: project?.rootPath || null,
        readSessionFile,
        saveSessionFile,
        sessionFiles,
        sessionId,
        threadId: threadRead?.thread_id ?? null,
        setArtifactViewMode: applyAutoArtifactViewMode,
        setCanvasState,
        setCanvasWorkbenchLayoutMode,
        setDocumentVersionStatusMap,
        setExpertInfoPanelCollapsed,
        setGeneralCanvasState,
        setHarnessPanelVisible,
        setLayoutMode,
        setSelectedArtifactId,
        setSelectedFileId,
        setTaskFiles,
        socialStageLogRef,
        suppressCanvasAutoOpen: hasPendingA2UIForm,
        taskFiles,
        taskFilesRef,
        themeWorkbenchActiveQueueItem,
        updateCurrentImageWorkbenchState,
        upsertGeneralArtifact,
        workbenchRequests,
      },
      surface: {
        setLayoutMode,
        workbenchRequests,
      },
    });
  const {
    bindArticleEditorRightSurface,
    bindRightSurfacePendingActions,
    handleCodeBlockClick,
    handleHarnessLoadFilePreview,
    handleOpenArtifactFromTimeline,
    handleOpenMessagePreview,
    handleOpenSavedSiteContent,
    handleOpenServiceSkillResultFile,
    handleOpenUrlPreview,
    handleSaveArtifactDocument,
    handleWorkspaceArtifactClick,
    handleWorkspaceFileClick,
    openWorkspaceArtifactInWorkbench,
    preferredServiceSkillResultFileTarget,
    renderArtifactWorkbenchToolbarActions,
    shouldCollapseCodeBlockInChat,
    shouldCollapseCodeBlocks,
    handleWriteFile,
    handleJumpToTimelineItem,
    serviceSkillExecutionCard,
  } = artifactInteractionRuntime;
  useWorkspaceWorkbenchSideEffectRuntime({
    autoGuide: {
      autoRunInitialPromptOnMount: resolvedAutoRunInitialPromptOnMount,
      canvasState,
      contentId,
      consumedInitialPromptRef,
      generalWorkbenchEntryCheckPending,
      generalWorkbenchEntryPrompt,
      handleSend,
      hasProject: Boolean(project),
      hasTriggeredGuideRef,
      initialAutoSendAllowsDetachedSession,
      initialAutoSendRequestMetadata,
      initialDispatchKey,
      initialUserPrompt,
      initialUserImages,
      isSending,
      isThemeWorkbench,
      mappedTheme,
      messagesLength: messages.length,
      onInitialUserPromptConsumed,
      projectId,
      sessionId,
      setInput,
      shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt,
      shouldUseCompactGeneralWorkbench,
      systemPrompt,
    },
    mediaTask: {
      canvasState,
      contentId,
      handleImageWorkbenchCommand,
      messages,
      onImageWorkbenchRequested:
        imageWorkbenchGenerationRuntime.ensureProvidersLoaded,
      projectId,
      projectRootPath: project?.rootPath || null,
      setCanvasState,
      setChatMessages,
      setImageWorkbenchSelectedSize,
      updateCurrentImageWorkbenchState,
    },
    triggerAIGuide,
  });

  const shellChromeRuntime = useWorkspaceShellChromeRuntime({
    activeTheme,
    agentEntry: resolvedAgentEntry,
    contextWorkspaceEnabled: isThemeWorkbench,
    effectiveShowChatPanel,
    gateStatus: currentGate.status,
    generalWorkbenchPanelCollapseEnabled:
      generalWorkbenchScaffoldRuntime.enableGeneralWorkbenchPanelCollapse,
    generalWorkbenchSidebarCollapsed:
      generalWorkbenchScaffoldRuntime.generalWorkbenchSidebarCollapsed,
    hasCanvasWorkbenchContent,
    hasDisplayMessages,
    hasHomeConversationActivity,
    hasPendingA2UIForm,
    hideTopBar: resolvedHideTopBar,
    isBootstrapDispatchPending,
    isPreparingSend,
    isSending,
    isTaskCenterDraftSendPending,
    isThemeWorkbench,
    layoutMode,
    normalizedInitialSessionId,
    queuedTurnCount,
    sessionId,
    shouldRenderTaskCenterEmbeddedHome,
    shouldSuppressTaskCenterDraftContent,
    shouldUseBrowserWorkspaceHomeChrome,
    shouldUseCompactGeneralWorkbench,
    showSidebar,
    subagentsRuntimeVisible,
    hasRuntimeSessions,
    themeWorkbenchRunState,
    topBarChrome: resolvedTopBarChrome,
  });
  const showGeneralWorkbenchSidebar =
    shellChromeRuntime.showGeneralWorkbenchSidebar;
  const showGeneralWorkbenchLeftExpandButton =
    shellChromeRuntime.showGeneralWorkbenchLeftExpandButton;
  const generalWorkbenchSidebarHostRuntime =
    useWorkspaceGeneralWorkbenchSidebarHostRuntime({
      generalWorkbenchHarnessSummary:
        harnessInventoryRuntime.generalWorkbenchHarnessSummary,
      generalWorkbenchScaffoldRuntime,
      handleSendRef,
      historyPageSize: GENERAL_WORKBENCH_HISTORY_PAGE_SIZE,
      isSending,
      isThemeWorkbench,
      messages,
      onAddImage: handleAddImage,
      onApplyFollowUpAction: applyWorkbenchFollowUpActionPayload,
      onCreateVersionSnapshot: handleCreateVersionSnapshot,
      onImportDocument: handleImportDocument,
      onSetBranchStatus: handleSetBranchStatus,
      onSwitchBranchVersion: handleSwitchBranchVersion,
      projectId,
      sessionId,
      sidebarVisible: showGeneralWorkbenchSidebar,
      themeWorkbenchBackendRunState,
    });
  const {
    generalWorkbenchActivityLogs,
    generalWorkbenchWorkflowSteps,
    handleExpandGeneralWorkbenchSidebar,
    handleSubmitCodeFixPrompt,
    renderGeneralWorkbenchSidebarNode,
  } = generalWorkbenchSidebarHostRuntime;
  const {
    handleManageProvidersFromHarness,
    handleOpenExecutionPolicySettingsFromHarness,
  } = useWorkspaceHarnessNavigationRuntime({ onNavigate: _onNavigate });
  const effectiveInitialInputCapability = useMemo(
    () =>
      resolveEffectiveInitialInputCapability({
        bootstrap: initialInputCapability,
        runtime: runtimeInitialInputCapability,
      }),
    [initialInputCapability, runtimeInitialInputCapability],
  );
  const { planComposerPendingActions, planDecisionAccessory } =
    useWorkspacePlanDecisionRuntime({
      acceptedLabel: t("agentChat.planComposerDecision.option.accept"),
      displayMessages,
      effectiveChatToolPreferences,
      effectiveThreadItems,
      handlePermissionResponse,
      handleSendRef,
      isSending,
      pendingActions,
      planState: harnessShellState.plan,
      sessionId,
      submittedActionsInFlight,
    });
  const generalWorkbenchHarnessPanelBaseProps =
    useWorkspaceGeneralWorkbenchHarnessSurfaceRuntime({
      activeExecutionRuntime,
      activeTheme,
      canInterrupt: inputbarIsSending,
      canonicalChildren,
      contextHarnessRuntime,
      currentTurnId,
      executionStrategy,
      harnessInventoryRuntime,
      latestAssistantMessageId,
      messages: displayMessages,
      model,
      onInterruptCurrentTurn: stopSending,
      onLoadFilePreview: handleHarnessLoadFilePreview,
      onManageProviders: handleManageProvidersFromHarness,
      onOpenExecutionPolicySettings:
        handleOpenExecutionPolicySettingsFromHarness,
      onOpenFile: handleWorkspaceFileClick,
      onOpenSubagentSession: handleOpenSubagentSession,
      onRespondToAction: handlePermissionResponse,
      onSubmitCodeFixPrompt: handleSubmitCodeFixPrompt,
      refreshSessionReadModel,
      pendingActions: planComposerPendingActions,
      projectId,
      providerType,
      replayPendingAction,
      sessionId,
      submittedActionsInFlight,
      threadItems: effectiveThreadItems,
      threadGoal,
      threadGoalError,
      threadGoalLoading: isThreadGoalLoading,
      threadRead,
      turns,
      workingDir: project?.rootPath || null,
    });
  useWorkspaceHiddenWorkflowProgressRuntime({
    hasMessages,
    isSpecializedThemeMode,
    onWorkflowProgressChange,
  });
  const navigationActions = useWorkspaceNavigationActions({
    applyProjectSelection,
    compactSession,
    dismissWorkspacePathError,
    fixWorkspacePathAndRetry,
    agentEntry: resolvedAgentEntry,
    externalProjectId,
    onNavigate: _onNavigate,
    projectId: projectId || undefined,
    setEntryBannerVisible,
    setWorkspaceHealthError,
    workspacePathMissing,
  });
  const { handleSaveMessageAsSkill } = useWorkspaceMessageSkillSaveRuntime({
    creationProjectId: projectId,
    creationReplay: initialCreationReplay,
    onNavigate: _onNavigate,
  });

  // prettier-ignore
  return {
    ...commandWiring.composerDraft,
    composerMode, setComposerMode,
    shellChromeRuntime, showGeneralWorkbenchLeftExpandButton, effectiveInitialInputCapability, generalWorkbenchHarnessPanelBaseProps, navigationActions, homePendingPreviewRequest, setHomePendingPreviewRequest,
    setTaskCenterDraftSendRequest, taskCenterDraftSendRequest, taskCenterHomeSurfaceActiveRef, generalWorkbenchEntryPrompt, handleBackHome, markTaskCenterLocalSessionOverride, setTaskCenterDetachedTopicId,
    setTaskCenterTransitionTopicId, upsertTaskCenterOpenTab, handleSend, handleSendRef, isPreparingSend, displayMessages, handleImageWorkbenchCommand,
    imageWorkbenchActionRuntime, handleContinueGeneralWorkbenchEntryPrompt, handleRestartGeneralWorkbenchEntryPrompt, handleDocumentAutoContinueRun, handleArtifactBlockRewriteRun, handleDocumentContentReviewRun, handleDocumentTextStylizeRun, handleAddImage,
    handleImportDocument, bootstrapPendingPreviewMessages, handleCanvasSelectionTextChange, handleCloseCanvas, bindBeforeCanvasLeave,
    handleOpenTaskTopic, handleToggleCanvas, hasDisplayMessages, hasMessages, homePendingPreviewMessages, isTaskCenterDraftSendPending, recentSessionTopic, resolvedCanvasState, shouldRenderTaskCenterEmbeddedHome, shouldRestoreImageTasksFromWorkspace, shouldSuppressTaskCenterDraftContent,
    suppressHomeNavbarUtilityActions, taskCenterHomeSurfaceState, bindArticleEditorRightSurface, bindRightSurfacePendingActions, handleCodeBlockClick,
    handleHarnessLoadFilePreview, handleOpenArtifactFromTimeline, handleOpenMessagePreview, handleOpenSavedSiteContent, handleOpenServiceSkillResultFile, handleOpenUrlPreview, handleSaveArtifactDocument, handleWorkspaceArtifactClick,
    handleWorkspaceFileClick, openWorkspaceArtifactInWorkbench, preferredServiceSkillResultFileTarget, renderArtifactWorkbenchToolbarActions, shouldCollapseCodeBlockInChat, shouldCollapseCodeBlocks, handleWriteFile,
    handleJumpToTimelineItem, serviceSkillExecutionCard, generalWorkbenchActivityLogs,
    generalWorkbenchWorkflowSteps, handleExpandGeneralWorkbenchSidebar, renderGeneralWorkbenchSidebarNode, planComposerPendingActions, planDecisionAccessory, handleSaveMessageAsSkill,
  };
}
