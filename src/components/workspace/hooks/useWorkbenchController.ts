import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  type ProjectType,
  getProjectTypeLabel,
  updateContent,
} from "@/lib/api/project";
import type {
  Page,
  PageParams,
  WorkspaceTheme,
  WorkspaceViewMode,
} from "@/types/page";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { getThemeModule } from "@/features/themes";
import { videoThemeModule } from "@/features/themes/video";
import type {
  ThemeWorkspaceView,
} from "@/features/themes/types";
import type { CreationMode } from "@/lib/workspace/workbenchContract";
import type { WorkflowProgressSnapshot } from "@/components/agent/chat";
import { useCreationDialogs } from "@/components/workspace/hooks/useCreationDialogs";
import { useWorkbenchNavigation } from "@/components/workspace/hooks/useWorkbenchNavigation";
import { useWorkbenchPanelRenderer } from "@/components/workspace/hooks/useWorkbenchPanelRenderer";
import { useWorkbenchProjectData } from "@/components/workspace/hooks/useWorkbenchProjectData";
import { useWorkbenchQuickActions } from "@/components/workspace/hooks/useWorkbenchQuickActions";
import type { A2UIFormData } from "@/lib/workspace/a2ui";
import { resolveWorkbenchHotkeyAction } from "@/components/workspace/hooks/workbenchHotkeys";

export const DEFAULT_CREATION_MODE: CreationMode = "guided";
export const MIN_CREATION_INTENT_LENGTH = 10;

export const CREATION_MODE_OPTIONS: Array<{
  value: CreationMode;
  label: string;
  description: string;
}> = [
  {
    value: "guided",
    label: "引导模式",
    description: "AI 分步骤提问引导，适合精细创作",
  },
  {
    value: "fast",
    label: "快速模式",
    description: "AI 先生成初稿，适合快速起稿",
  },
  {
    value: "hybrid",
    label: "混合模式",
    description: "AI 与你协作，平衡质量和效率",
  },
  {
    value: "framework",
    label: "框架模式",
    description: "你定结构，AI 按框架补全内容",
  },
];

export function getWorkflowStepStatusLabel(
  status: WorkflowProgressSnapshot["steps"][number]["status"],
): string {
  switch (status) {
    case "active":
      return "进行中";
    case "completed":
      return "已完成";
    case "skipped":
      return "已跳过";
    case "error":
      return "异常";
    default:
      return "待开始";
  }
}

export interface UseWorkbenchControllerParams {
  onNavigate?: (page: Page, params?: PageParams) => void;
  initialProjectId?: string;
  initialContentId?: string;
  theme: WorkspaceTheme;
  initialViewMode?: WorkspaceViewMode;
  resetAt?: number;
  initialCreatePrompt?: string;
  initialCreateSource?: "workspace_prompt" | "quick_create" | "project_created";
  initialCreateFallbackTitle?: string;
}

interface UseWorkbenchBootstrapParams {
  applyInitialNavigationState: (
    initialViewMode: WorkspaceViewMode | undefined,
    initialContentId: string | undefined,
  ) => void;
  clearContentsSelection: () => void;
  initialContentId?: string;
  initialProjectId?: string;
  initialViewMode?: WorkspaceViewMode;
  loadProjects: () => Promise<void>;
  resetProjectAndContentQueries: () => void;
  resetAt?: number;
  setSelectedContentId: (contentId: string | null) => void;
  setSelectedProjectId: (projectId: string | null) => void;
  theme: WorkspaceTheme;
}

function useWorkbenchBootstrap({
  applyInitialNavigationState,
  clearContentsSelection,
  initialContentId,
  initialProjectId,
  initialViewMode,
  loadProjects,
  resetProjectAndContentQueries,
  resetAt,
  setSelectedContentId,
  setSelectedProjectId,
  theme,
}: UseWorkbenchBootstrapParams): void {
  useEffect(() => {
    resetProjectAndContentQueries();
    setSelectedProjectId(initialProjectId ?? null);
    setSelectedContentId(initialContentId ?? null);
    applyInitialNavigationState(initialViewMode, initialContentId);
    clearContentsSelection();
    void loadProjects();
  }, [
    applyInitialNavigationState,
    clearContentsSelection,
    initialContentId,
    initialProjectId,
    initialViewMode,
    loadProjects,
    resetProjectAndContentQueries,
    resetAt,
    setSelectedContentId,
    setSelectedProjectId,
    theme,
  ]);
}

interface UseSelectedProjectContentsLoaderParams {
  clearContentsSelection: () => void;
  loadContents: (projectId: string) => Promise<void>;
  projects: Array<unknown>;
  selectedProjectId: string | null;
}

function useSelectedProjectContentsLoader({
  clearContentsSelection,
  loadContents,
  projects,
  selectedProjectId,
}: UseSelectedProjectContentsLoaderParams): void {
  useEffect(() => {
    if (!selectedProjectId) {
      clearContentsSelection();
      return;
    }
    void loadContents(selectedProjectId);
  }, [clearContentsSelection, loadContents, selectedProjectId, projects]);
}

function useSidebarToggleHotkey(toggleLeftSidebar: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (resolveWorkbenchHotkeyAction(event) !== "toggle-sidebar") {
        return;
      }

      event.preventDefault();
      toggleLeftSidebar();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleLeftSidebar]);
}

export function useWorkbenchController({
  onNavigate,
  initialProjectId,
  initialContentId,
  theme,
  initialViewMode,
  resetAt,
  initialCreatePrompt,
  initialCreateSource,
  initialCreateFallbackTitle,
}: UseWorkbenchControllerParams) {
  const { leftSidebarCollapsed, toggleLeftSidebar, setLeftSidebarCollapsed } =
    useWorkbenchStore();
  const themeModule = useMemo(() => {
    const resolvedThemeModule = getThemeModule(theme);
    if (
      theme === "video" &&
      resolvedThemeModule.capabilities.workspaceKind !== "video-canvas"
    ) {
      return videoThemeModule;
    }
    return resolvedThemeModule;
  }, [theme]);
  const PrimaryWorkspaceRenderer =
    themeModule.primaryWorkspaceRenderer ?? themeModule.workspaceRenderer;
  const panelRenderers = themeModule.panelRenderers;
  const isAgentChatWorkspace =
    themeModule.capabilities.workspaceKind === "agent-chat";
  const isVideoCanvasWorkspace =
    themeModule.capabilities.workspaceKind === "video-canvas";
  const shouldRenderWorkspaceRightRailInWorkspace =
    themeModule.capabilities.showWorkspaceRightRailInWorkspace ??
    (themeModule.capabilities.workspaceKind === "video-canvas" ||
      (isAgentChatWorkspace && !PrimaryWorkspaceRenderer));

  const {
    projects,
    projectsLoading,
    selectedProjectId,
    setSelectedProjectId,
    contents,
    contentsLoading,
    selectedContentId,
    setSelectedContentId,
    projectQuery,
    setProjectQuery,
    contentQuery,
    setContentQuery,
    selectedProject,
    filteredProjects,
    filteredContents,
    loadProjects,
    loadContents,
    resetProjectAndContentQueries,
    clearContentsSelection,
  } = useWorkbenchProjectData({
    theme,
    initialProjectId,
    initialContentId,
  });

  const {
    workflowProgress,
    setWorkflowProgress,
    showWorkflowRail,
    setShowWorkflowRail,
    workspaceMode,
    setWorkspaceMode,
    activeWorkspaceView,
    setActiveWorkspaceView,
    shouldRenderLeftSidebar,
    isCreateWorkspaceView,
    shouldRenderWorkspaceRightRail,
    activeWorkspaceViewLabel,
    hasWorkflowWorkspaceView,
    hasPublishWorkspaceView,
    hasSettingsWorkspaceView,
    applyInitialNavigationState,
    handleOpenWorkflowView,
    handleBackToProjectManagement,
    handleEnterWorkspaceView,
    handleSwitchWorkspaceView,
  } = useWorkbenchNavigation({
    initialViewMode,
    initialContentId,
    defaultWorkspaceView: themeModule.navigation.defaultView,
    navigationItems: themeModule.navigation.items,
    leftSidebarCollapsed,
    setLeftSidebarCollapsed,
    isAgentChatWorkspace,
    hasPrimaryWorkspaceRenderer: Boolean(PrimaryWorkspaceRenderer),
    shouldRenderWorkspaceRightRailInWorkspace,
  });
  const [currentChatSessionId, setCurrentChatSessionId] = useState<string | null>(
    null,
  );
  const [showCreateContentEntryHome, setShowCreateContentEntryHome] = useState(false);

  const handleEnterWorkspace = useCallback(
    (
      contentId: string,
      options?: {
        createEntryHome?: boolean;
      },
    ) => {
      const normalizedContentId = contentId.trim();
      setSelectedContentId(normalizedContentId || null);
      setShowCreateContentEntryHome(
        Boolean(
          !isVideoCanvasWorkspace &&
            options?.createEntryHome &&
            !normalizedContentId,
        ),
      );
      setCurrentChatSessionId(null);
      setWorkspaceMode("workspace");
      setActiveWorkspaceView("create");
      setLeftSidebarCollapsed(true);
    },
    [
      setActiveWorkspaceView,
      setCurrentChatSessionId,
      isVideoCanvasWorkspace,
      setLeftSidebarCollapsed,
      setSelectedContentId,
      setWorkspaceMode,
    ],
  );

  const handleSelectProjectAndEnterWorkspace = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      setSelectedContentId(null);
      setContentQuery("");
      setCurrentChatSessionId(null);
      setShowCreateContentEntryHome(false);
      setShowWorkflowRail(false);

      if (workspaceMode === "project-management") {
        setLeftSidebarCollapsed(false);
        return;
      }

      setWorkspaceMode("workspace");
      setActiveWorkspaceView(themeModule.navigation.defaultView);
      setLeftSidebarCollapsed(true);
    },
    [
        setActiveWorkspaceView,
      setContentQuery,
      setCurrentChatSessionId,
      setLeftSidebarCollapsed,
      setSelectedContentId,
      setSelectedProjectId,
        setShowWorkflowRail,
      setWorkspaceMode,
      themeModule.navigation.defaultView,
      workspaceMode,
    ],
  );

  const {
    createProjectDialogOpen,
    setCreateProjectDialogOpen,
    createContentDialogOpen,
    setCreateContentDialogOpen,
    createContentDialogStep,
    setCreateContentDialogStep,
    newProjectName,
    setNewProjectName,
    workspaceProjectsRoot,
    creatingProject,
    creatingContent,
    selectedCreationMode,
    setSelectedCreationMode,
    creationIntentValues,
    creationIntentError,
    setCreationIntentError,
    currentCreationIntentFields,
    currentIntentLength,
    pendingInitialPromptsByContentId,
    pendingCreateConfirmationByProjectId,
    creationModes,
    creationTypes,
    resolvedProjectPath,
    pathChecking,
    pathConflictMessage,
    resetCreateContentDialogState,
    handleOpenCreateProjectDialog,
    handleCreateProject,
    handleOpenCreateContentDialog,
    handleCreateContentFromWorkspaceEntry,
    handleCreateContentFromWorkspacePrompt,
    handleCreationIntentValueChange,
    handleGoToIntentStep,
    handleCreateContent,
    submitCreateConfirmation,
    consumePendingInitialPrompt,
    consumePendingCreateConfirmation,
  } = useCreationDialogs({
    theme,
    selectedProjectId,
    selectedContentId,
    loadProjects,
    loadContents,
    onEnterWorkspace: handleEnterWorkspace,
    onProjectCreated: (projectId) => {
      setSelectedProjectId(projectId);
      setProjectQuery("");
    },
    defaultCreationMode: DEFAULT_CREATION_MODE,
    minCreationIntentLength: MIN_CREATION_INTENT_LENGTH,
    initialCreateConfirmation: {
      prompt: initialCreatePrompt,
      source: initialCreateSource,
      fallbackContentTitle: initialCreateFallbackTitle,
      creationMode: DEFAULT_CREATION_MODE,
    },
  });

  const handleQuickSaveCurrent = useCallback(async () => {
    if (!selectedContentId || !selectedProjectId) {
      return;
    }

    try {
      await updateContent(selectedContentId, {
        metadata: {
          saved_from: "theme-workspace",
          saved_at: Date.now(),
        },
      });
      toast.success("已保存当前文稿");
      await loadContents(selectedProjectId);
    } catch (error) {
      console.error("保存失败:", error);
      toast.error("保存失败");
    }
  }, [loadContents, selectedContentId, selectedProjectId]);

  useEffect(() => {
    if (
      isVideoCanvasWorkspace ||
      workspaceMode !== "workspace" ||
      activeWorkspaceView !== "create" ||
      !selectedProjectId ||
      selectedContentId ||
      showCreateContentEntryHome ||
      contentsLoading ||
      contents.length === 0
    ) {
      return;
    }

    const latestContent = contents[0];
    if (!latestContent?.id) {
      return;
    }

    setSelectedContentId(latestContent.id);
  }, [
    activeWorkspaceView,
    contents,
    contentsLoading,
    selectedContentId,
    selectedProjectId,
    setSelectedContentId,
    showCreateContentEntryHome,
    isVideoCanvasWorkspace,
    workspaceMode,
  ]);

  useWorkbenchBootstrap({
    applyInitialNavigationState,
    clearContentsSelection,
    initialContentId,
    initialProjectId,
    initialViewMode,
    loadProjects,
    resetProjectAndContentQueries,
    resetAt,
    setSelectedContentId,
    setSelectedProjectId,
    theme,
  });
  useSelectedProjectContentsLoader({
    clearContentsSelection,
    loadContents,
    projects,
    selectedProjectId,
  });

  const handleBackHome = useCallback(() => {
    onNavigate?.("agent", buildHomeAgentParams());
  }, [onNavigate]);

  const handleOpenCreateHome = useCallback(() => {
    setWorkspaceMode("workspace");
    setActiveWorkspaceView("create");
    setSelectedContentId(null);
    setShowCreateContentEntryHome(!isVideoCanvasWorkspace);
    setCurrentChatSessionId(null);
    setShowWorkflowRail(false);
  }, [
    setActiveWorkspaceView,
    setSelectedContentId,
    setCurrentChatSessionId,
    setShowWorkflowRail,
    setWorkspaceMode,
    isVideoCanvasWorkspace,
  ]);

  useSidebarToggleHotkey(toggleLeftSidebar);

  const currentContentTitle = selectedContentId
    ? contents.find((item) => item.id === selectedContentId)?.title || "已选文稿"
    : null;

  const { activePanelRenderer } = useWorkbenchPanelRenderer({
    activeWorkspaceView,
    panelRenderers,
  });
  const workspaceViewLabels = useMemo(
    () =>
      themeModule.navigation.items.reduce<Partial<Record<ThemeWorkspaceView, string>>>(
        (labels, item) => {
          labels[item.key] = item.label;
          return labels;
        },
        {},
      ),
    [themeModule.navigation.items],
  );

  const { nonCreateQuickActions } = useWorkbenchQuickActions({
    workspaceMode,
    activeWorkspaceView,
    hasWorkflowWorkspaceView,
    hasPublishWorkspaceView,
    hasSettingsWorkspaceView,
    workspaceViewLabels,
    selectedContentId,
    onSwitchWorkspaceView: handleSwitchWorkspaceView,
    onQuickSaveCurrent: handleQuickSaveCurrent,
  });

  const ActivePanelRenderer = activePanelRenderer;
  const projectTypeLabel = getProjectTypeLabel(theme as ProjectType);
  const pendingCreateConfirmation = selectedProjectId
    ? pendingCreateConfirmationByProjectId[selectedProjectId]
    : undefined;

  const handleSubmitCreateConfirmation = useCallback(
    async (formData: A2UIFormData) => {
      if (!selectedProjectId) {
        return;
      }
      await submitCreateConfirmation(selectedProjectId, formData);
    },
    [selectedProjectId, submitCreateConfirmation],
  );

  const handleCancelCreateConfirmation = useCallback(() => {
    if (!selectedProjectId) {
      return;
    }
    consumePendingCreateConfirmation(selectedProjectId);
  }, [consumePendingCreateConfirmation, selectedProjectId]);

  return {
    themeModule,
    leftSidebarCollapsed,
    toggleLeftSidebar,

    workflowProgress,
    setWorkflowProgress,
    showWorkflowRail,
    setShowWorkflowRail,
    currentChatSessionId,
    setCurrentChatSessionId,

    workspaceMode,
    activeWorkspaceView,
    setCreateProjectDialogOpen,
    setCreateContentDialogOpen,
    setCreateContentDialogStep,
    setCreationIntentError,
    setNewProjectName,
    setSelectedCreationMode,
    setProjectQuery,
    setContentQuery,

    selectedProject,
    selectedProjectId,
    selectedContentId,
    projectsLoading,
    contentsLoading,
    filteredProjects,
    filteredContents,
    projectQuery,
    contentQuery,
    createProjectDialogOpen,
    createContentDialogOpen,
    createContentDialogStep,
    newProjectName,
    workspaceProjectsRoot,
    creatingProject,
    creatingContent,
    selectedCreationMode,
    creationIntentValues,
    creationIntentError,
    currentCreationIntentFields,
    currentIntentLength,
    pendingInitialPromptsByContentId,
    pendingCreateConfirmation,
    creationModes,
    creationTypes,
    resolvedProjectPath,
    pathChecking,
    pathConflictMessage,
    projectTypeLabel,

    shouldRenderLeftSidebar,
    isCreateWorkspaceView,
    showCreateContentEntryHome,
    shouldRenderWorkspaceRightRail,
    activeWorkspaceViewLabel,
    hasWorkflowWorkspaceView,
    currentContentTitle,
    nonCreateQuickActions,
    ActivePanelRenderer,
    PrimaryWorkspaceRenderer,

    handleEnterWorkspace,
    handleSelectProjectAndEnterWorkspace,
    handleOpenWorkflowView,
    loadProjects,
    handleOpenCreateProjectDialog,
    handleCreateProject,
    resetCreateContentDialogState,
    handleOpenCreateContentDialog,
    handleCreateContentFromWorkspaceEntry,
    handleCreateContentFromWorkspacePrompt,
    handleCreationIntentValueChange,
    handleGoToIntentStep,
    handleCreateContent,
    handleSubmitCreateConfirmation,
    handleCancelCreateConfirmation,
    consumePendingInitialPrompt,
    handleQuickSaveCurrent,
    handleBackHome,
    handleOpenCreateHome,
    handleBackToProjectManagement,
    handleEnterWorkspaceView,
    handleSwitchWorkspaceView,

    selectedProjectForContentActions: Boolean(selectedProjectId),
  };
}

export default useWorkbenchController;
