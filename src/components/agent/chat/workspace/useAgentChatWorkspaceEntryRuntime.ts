/** Workspace entry/bootstrap current owner。 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { usePathReferences } from "../hooks/usePathReferences";

import { useWorkspaceWorkbenchRequests } from "../hooks/useWorkspaceWorkbenchRequests";

import { useContentSync } from "../hooks/useContentSync";

import { useServiceModelsConfig } from "@/hooks/useServiceModelsConfig";





import { type TaskFile } from "../components/TaskFiles";

import {
  type CanvasState as GeneralCanvasState,
  DEFAULT_CANVAS_STATE,
} from "@/components/general-chat/bridge";

import { type Character } from "@/lib/api/projectMemory";

import type { WriteArtifactContext } from "../types";

import {
  isSpecializedWorkbenchTheme,
  type ThemeType,
} from "@/lib/workspace/workbenchContract";

import { normalizeProjectId } from "../utils/topicProjectResolution";

import { useThemeScopedChatToolPreferences } from "../hooks/useThemeScopedChatToolPreferences";

import { useWorkspaceProjectSelection } from "../hooks/useWorkspaceProjectSelection";

import { useWorkbenchStore } from "@/stores/useWorkbenchStore";

import { useSessionRecentMetadataSyncRuntime } from "./useSessionRecentMetadataSyncRuntime";

import { useWorkspaceImageWorkbenchProviderRuntime } from "./useWorkspaceImageWorkbenchProviderRuntime";

import { useWorkspaceOpenedProjectsRuntime } from "./useWorkspaceOpenedProjectsRuntime";

import { useWorkspaceProjectContentRuntime } from "./useWorkspaceProjectContentRuntime";

import { useWorkspaceDefaultProjectAliasRuntime } from "./useWorkspaceDefaultProjectAliasRuntime";

import { normalizeInitialTheme } from "../agentChatWorkspaceShared";

import type { AgentChatWorkspaceProps } from "../agentChatWorkspaceContract";

import { resolveWorkspaceEntryLoadDeferral } from "./workspaceEntryLoadDeferral";

import { useWorkspaceSkillDirectoryRuntime } from "./useWorkspaceSkillDirectoryRuntime";

import {
  useWorkspaceActiveContentTargetRuntime,
  useWorkspaceEntryStateRuntime,

  useWorkspaceTaskFilesRefSyncRuntime,
} from "./useWorkspaceEntrySideEffectsRuntime";

import { useWorkspaceEntryProjectionRuntime } from "./useWorkspaceEntryProjectionRuntime";

import { useAgentChatWorkspaceLocalDisplayState } from "./useAgentChatWorkspaceLocalDisplayState";

import { useWorkspaceEntryNavigationRuntime } from "./useWorkspaceEntryNavigationRuntime";

export function useAgentChatWorkspaceEntryRuntime({
  onNavigate: _onNavigate,
  projectId: externalProjectId,
  contentId,
  initialSessionId,
  initialRequestMetadata,
  initialAutoSendRequestMetadata,
  autoRunInitialPromptOnMount = false,
  agentEntry = "conversation",
  theme: initialTheme,
  initialCreationMode,
  lockTheme = false,
  showChatPanel = true,
  initialUserPrompt,
  initialUserImages,
  entryBannerMessage,
  initialPendingServiceSkillLaunch,
  initialInputCapability,
  initialProjectFileOpenTarget,
  newChatAt,
  initialSiteSkillLaunch,
}: AgentChatWorkspaceProps) {
  const { t } = useTranslation("agent");
  const untitledTaskLabel = t(
    "generalWorkbench.workflow.outputs.summary.untitledTask",
  );
  // 性能埋点：记录组件渲染开始时间
  const workspaceRenderT0 = useRef<number>(performance.now());
  useEffect(() => {
    console.info(
      `[PERF] AgentChatWorkspace mounted: ${(performance.now() - workspaceRenderT0.current).toFixed(0)}ms`,
    );
  }, []);

  const normalizedEntryTheme = normalizeInitialTheme(initialTheme);
  const shouldCollapseConversationSidebar = agentEntry === "conversation";
  const defaultTopicSidebarVisible =
    showChatPanel && !shouldCollapseConversationSidebar;
  const shouldBootstrapCanvasOnEntry =
    Boolean(contentId) && isSpecializedWorkbenchTheme(normalizedEntryTheme);
  const shouldKeepNewTaskHomeSessionRestoreDisabled =
    agentEntry === "new-task" && !contentId;
  const localDisplayRuntime = useAgentChatWorkspaceLocalDisplayState({
    defaultTopicSidebarVisible,
    entryBannerMessage,
    initialCreationMode,
    normalizedEntryTheme,
    shouldBootstrapCanvasOnEntry,
  });
  const {
    activeTheme,
    artifactPreviewSize,
    creationMode,
    composerController,
    resetComposerDraft,
    effectiveEntryBannerMessage,
    entryBannerVisible,
    expertInfoPanelCollapsed,

    handleInputRestoreRequestHandled,
    handleRestoreInterruptedInput,
    input,
    inputbarObjectiveModeEnabled,
    inputRestoreRequest,
    layoutMode,
    runtimeInitialInputCapability,
    selectedText,
    setActiveTheme,
    setArtifactPreviewSize,
    setCanvasWorkbenchLayoutMode,
    setCreationMode,
    setEntryBannerVisible,
    setExpertInfoPanelCollapsed,
    setInput,
    setInputbarObjectiveModeEnabled,
    setLayoutMode,
    setRuntimeEntryBannerMessage,
    setShowSidebar,
    showSidebar,
  } = localDisplayRuntime;
  const {
    pathReferences,
    addPathReferences: handleAddPathReferences,
    removePathReference: handleRemovePathReference,
    clearPathReferences: handleClearPathReferences,
  } = usePathReferences([], composerController);

  const {
    activeSessionIdRef,
    chatToolPreferenceSessionSync,
    deferSessionRecentMetadataSyncForNavigation,
    syncSessionRecentPreferences,
  } = useSessionRecentMetadataSyncRuntime();
  const {
    chatToolPreferences,
    setChatToolPreferences,
    syncChatToolPreferencesSource,
    getSyncedSessionRecentPreferences,
  } = useThemeScopedChatToolPreferences(activeTheme, {
    sessionSync: chatToolPreferenceSessionSync,
  });
  const { handleOpenSkillsManageFromExpertPanel, handleOpenSubagents } =
    useWorkspaceEntryNavigationRuntime({
      onNavigate: _onNavigate,
      setChatToolPreferences,
    });
  const projectSelectionRuntime = useWorkspaceProjectSelection({
    autoRunInitialPromptOnMount,
    externalProjectId,
    initialSessionId,
    keepNewChatSessionRestoreDisabled:
      shouldKeepNewTaskHomeSessionRestoreDisabled,
    newChatAt,
  });
  const {
    projectId,
    shouldDisableSessionRestore,
    markNewChatRequestHandled,
    rememberProjectId,
    getRememberedProjectId,
    applyProjectSelection,
    resetProjectSelection,
  } = projectSelectionRuntime;
  const taskCenterWorkspaceId = normalizeProjectId(projectId);
  const normalizedInitialSessionId =
    typeof initialSessionId === "string" && initialSessionId.trim().length > 0
      ? initialSessionId.trim()
      : null;
  const sessionRestorePresentation: "background" | "foreground" =
    shouldKeepNewTaskHomeSessionRestoreDisabled && !normalizedInitialSessionId
      ? "background"
      : "foreground";
  const {
    shouldPreserveEntryThemeOnHome,
    shouldPreserveBlankHomeSurface,
    shouldUseBrowserWorkspaceHomeChrome,
    shouldDeferWorkspaceAuxiliaryLoads,
    shouldDeferInitialTopicsLoad,
    shouldDeferInitialRuntimeWarmup,
    deferredWorkspaceAuxiliaryLoadMs,
    deferredInitialTopicsLoadMs,
    deferredInitialRuntimeWarmupMs,
  } = resolveWorkspaceEntryLoadDeferral({
    agentEntry,
    contentId,
    normalizedEntryTheme,
    normalizedInitialSessionId,
    initialUserPrompt,
    initialUserImages,
    initialSiteSkillLaunch,
    initialPendingServiceSkillLaunch,
    initialInputCapability,
    initialProjectFileOpenTarget,
  });
  const {
    project,
    setProject,
    projectMemory,
    setProjectMemory,
    isInitialContentLoading,
    initialContentLoadError,
    canvasState,
    setCanvasState,
    documentVersionStatusMap,
    setDocumentVersionStatusMap,
    contentMetadataRef,
    persistedWorkbenchSnapshotRef,
    lastCanvasSyncRequestRef,
  } = useWorkspaceProjectContentRuntime({
    projectId,
    contentId,
    externalProjectId,
    lockTheme,
    initialTheme,
    normalizedEntryTheme,
    shouldBootstrapCanvasOnEntry,
    shouldDeferWorkspaceAuxiliaryLoads,
    shouldPreserveEntryThemeOnHome,
    deferredWorkspaceAuxiliaryLoadMs,
    resetProjectSelection,
    setActiveTheme,
    setLayoutMode,
  });

  useWorkspaceEntryStateRuntime({
    effectiveEntryBannerMessage,
    entryBannerMessage,
    initialCreationMode,
    initialTheme,
    setActiveTheme,
    setCreationMode,
    setEntryBannerVisible,
    setRuntimeEntryBannerMessage,
  });

  useWorkspaceDefaultProjectAliasRuntime({
    applyProjectSelection,
    externalProjectId,
    getRememberedProjectId,
    projectId,
    resetProjectSelection,
    setProject,
  });

  const {
    dismissedInitialPendingServiceSkillLaunchSignatureRef,
    handledInitialPendingServiceSkillLaunchSignatureRef,
    initialAutoSendAllowsDetachedSession,
    initialCreationReplay,
    initialCreationReplaySurface,
    initialPendingServiceSkillLaunchSignature,
    runtimeWorkspaceId,
    validatedRuntimeProjectId,
  } = useWorkspaceEntryProjectionRuntime({
    initialAutoSendRequestMetadata,
    initialPendingServiceSkillLaunch,
    initialRequestMetadata,
    projectId,
    resolvedProjectId: project?.id,
    taskCenterWorkspaceId,
  });

  useWorkspaceActiveContentTargetRuntime({
    canvasType: canvasState?.type ?? null,
    contentId,
    projectId,
  });

  // General 主题专用画布状态
  const [generalCanvasState, setGeneralCanvasState] =
    useState<GeneralCanvasState>(DEFAULT_CANVAS_STATE);

  // 任务文件状态
  const [taskFiles, setTaskFiles] = useState<TaskFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();
  const taskFilesRef = useRef<TaskFile[]>([]);
  const socialStageLogRef = useRef<Record<string, string>>({});

  const { openedProjects, handleCloseOpenedProject } =
    useWorkspaceOpenedProjectsRuntime({
      project,
      projectId,
      applyProjectSelection,
      setProject,
      setProjectMemory,
    });
  const {
    serviceModels,
    agentResponseLanguage,
    refresh: refreshServiceModelsConfig,
  } = useServiceModelsConfig({
    enabled: !shouldDeferWorkspaceAuxiliaryLoads,
  });




  const {
    effectiveImageWorkbenchPreference,
    imageGenerationSelectionReady,
    imageGenerationSelectionWarning,
    imageWorkbenchGenerationRuntime,
    imageWorkbenchPreferenceSummary,
    imageWorkbenchPreferenceWarning,
    setOnDemandMediaDefaults,
  } = useWorkspaceImageWorkbenchProviderRuntime({
    contentId,
    deferredWorkspaceAuxiliaryLoadMs,
    initialSessionId,
    projectImageGenerationPreference: project?.settings?.imageGeneration,
    selectionProjectId: externalProjectId ?? project?.id ?? null,
    shouldDeferWorkspaceAuxiliaryLoads,
  });
  const {
    selectedProviderId: imageWorkbenchSelectedProviderId,
    selectedModelId: imageWorkbenchSelectedModelId,
    selectedSize: imageWorkbenchSelectedSize,
    setSelectedSize: setImageWorkbenchSelectedSize,
    preferredProviderUnavailable: imageWorkbenchPreferredProviderUnavailable,
    ensureProvidersLoaded: ensureImageWorkbenchProvidersLoaded,
    providersLoading: imageWorkbenchProvidersLoading,
  } = imageWorkbenchGenerationRuntime;

  useWorkspaceTaskFilesRefSyncRuntime({
    taskFiles,
    taskFilesRef,
  });

  // 引用的角色列表（用于注入到消息中）
  const [mentionedCharacters, setMentionedCharacters] = useState<Character[]>(
    [],
  );
  const {
    skills,
    skillsLoading,
    serviceSkills,
    serviceSkillGroups,
    serviceSkillsLoading,
    serviceSkillsError,
    recordServiceSkillUsage,
    handleRefreshSkills,
    handleSkillSuggestionsNeeded,
  } = useWorkspaceSkillDirectoryRuntime({
    activeTheme,
    autoLoadServiceSkills: Boolean(initialPendingServiceSkillLaunchSignature),
    deferredDelayMs: deferredWorkspaceAuxiliaryLoadMs,
    shouldDeferWorkspaceAuxiliaryLoads,
  });

  // Workbench Store（用于工作区右侧技能面板状态同步）
  const pendingSkillKey = useWorkbenchStore((state) => state.pendingSkillKey);
  const clearThemeSkillsRailState = useWorkbenchStore(
    (state) => state.clearThemeSkillsRailState,
  );
  const consumePendingSkill = useWorkbenchStore(
    (state) => state.consumePendingSkill,
  );

  // 用于追踪已处理的消息 ID，避免重复处理
  const processedMessageIds = useRef<Set<string>>(new Set());
  // 文件写入回调 ref（用于传递给统一聊天主链 Hook）
  const handleWriteFileRef =
    useRef<
      (
        content: string,
        fileName: string,
        context?: WriteArtifactContext,
      ) => void
    >();
  const sceneGateResumeHandlerRef = useRef<
    (input: {
      rawText: string;
      requestMetadata: Record<string, unknown>;
    }) => Promise<boolean>
  >(async () => false);

  const mappedTheme = activeTheme as ThemeType;

  // 内容同步 Hook
  const { syncContent, syncStatus } = useContentSync({
    debounceMs: 2000,
    autoRetry: true,
    retryDelayMs: 5000,
  });

  // 判断是否为内容创作模式
  const isSpecializedThemeMode = isSpecializedWorkbenchTheme(activeTheme);

  const workbenchRequests = useWorkspaceWorkbenchRequests();

  // 跳转到技能主页面
  const handleNavigateToSkillSettings = useCallback(() => {
    _onNavigate?.("skills");
  }, [_onNavigate]);
  useEffect(() => {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (!normalizedProjectId) {
      return;
    }

    if (project?.id === normalizedProjectId && project.isArchived) {
      return;
    }
    rememberProjectId(normalizedProjectId);
  }, [project, projectId, rememberProjectId]);

  return {
    t,
    untitledTaskLabel,
    workspaceRenderT0,
    normalizedEntryTheme,
    shouldCollapseConversationSidebar,
    defaultTopicSidebarVisible,
    shouldBootstrapCanvasOnEntry,
    shouldKeepNewTaskHomeSessionRestoreDisabled,
    localDisplayRuntime,
    composerController,
    resetComposerDraft,
    activeTheme,
    artifactPreviewSize,
    creationMode,
    effectiveEntryBannerMessage,
    entryBannerVisible,
    expertInfoPanelCollapsed,

    handleInputRestoreRequestHandled,
    handleRestoreInterruptedInput,
    input,
    inputbarObjectiveModeEnabled,
    inputRestoreRequest,
    layoutMode,
    runtimeInitialInputCapability,
    selectedText,
    setActiveTheme,
    setArtifactPreviewSize,
    setCanvasWorkbenchLayoutMode,
    setCreationMode,
    setEntryBannerVisible,
    setExpertInfoPanelCollapsed,
    setInput,
    setInputbarObjectiveModeEnabled,
    setLayoutMode,
    setRuntimeEntryBannerMessage,
    setShowSidebar,
    showSidebar,
    pathReferences,
    handleAddPathReferences,
    handleRemovePathReference,
    handleClearPathReferences,

    activeSessionIdRef,
    chatToolPreferenceSessionSync,
    deferSessionRecentMetadataSyncForNavigation,
    syncSessionRecentPreferences,
    chatToolPreferences,
    setChatToolPreferences,
    syncChatToolPreferencesSource,
    getSyncedSessionRecentPreferences,

    handleOpenSkillsManageFromExpertPanel,
    handleOpenSubagents,
    projectSelectionRuntime,
    projectId,
    shouldDisableSessionRestore,
    markNewChatRequestHandled,
    rememberProjectId,
    getRememberedProjectId,
    applyProjectSelection,
    resetProjectSelection,
    taskCenterWorkspaceId,
    normalizedInitialSessionId,
    sessionRestorePresentation,
    shouldPreserveEntryThemeOnHome,
    shouldPreserveBlankHomeSurface,
    shouldUseBrowserWorkspaceHomeChrome,
    shouldDeferWorkspaceAuxiliaryLoads,
    shouldDeferInitialTopicsLoad,
    shouldDeferInitialRuntimeWarmup,
    deferredWorkspaceAuxiliaryLoadMs,
    deferredInitialTopicsLoadMs,
    deferredInitialRuntimeWarmupMs,
    project,
    setProject,
    projectMemory,
    setProjectMemory,
    isInitialContentLoading,
    initialContentLoadError,
    canvasState,
    setCanvasState,
    documentVersionStatusMap,
    setDocumentVersionStatusMap,
    contentMetadataRef,
    persistedWorkbenchSnapshotRef,
    lastCanvasSyncRequestRef,
    dismissedInitialPendingServiceSkillLaunchSignatureRef,
    handledInitialPendingServiceSkillLaunchSignatureRef,
    initialAutoSendAllowsDetachedSession,
    initialCreationReplay,
    initialCreationReplaySurface,
    initialPendingServiceSkillLaunchSignature,
    runtimeWorkspaceId,
    validatedRuntimeProjectId,
    generalCanvasState,
    setGeneralCanvasState,
    taskFiles,
    setTaskFiles,
    selectedFileId,
    setSelectedFileId,
    taskFilesRef,
    socialStageLogRef,
    openedProjects,
    handleCloseOpenedProject,

    serviceModels,
    agentResponseLanguage,
    refreshServiceModelsConfig,





    effectiveImageWorkbenchPreference,
    imageGenerationSelectionReady,
    imageGenerationSelectionWarning,
    imageWorkbenchGenerationRuntime,
    imageWorkbenchPreferenceSummary,
    imageWorkbenchPreferenceWarning,
    setOnDemandMediaDefaults,
    imageWorkbenchSelectedProviderId,
    imageWorkbenchSelectedModelId,
    imageWorkbenchSelectedSize,
    setImageWorkbenchSelectedSize,
    imageWorkbenchPreferredProviderUnavailable,
    ensureImageWorkbenchProvidersLoaded,
    imageWorkbenchProvidersLoading,
    mentionedCharacters,
    setMentionedCharacters,
    skills,
    skillsLoading,
    serviceSkills,
    serviceSkillGroups,
    serviceSkillsLoading,
    serviceSkillsError,
    recordServiceSkillUsage,
    handleRefreshSkills,
    handleSkillSuggestionsNeeded,
    pendingSkillKey,
    clearThemeSkillsRailState,
    consumePendingSkill,
    processedMessageIds,
    handleWriteFileRef,
    sceneGateResumeHandlerRef,
    mappedTheme,
    syncContent,
    syncStatus,
    isSpecializedThemeMode,
    workbenchRequests,
    handleNavigateToSkillSettings,
  };
}
