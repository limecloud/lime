/**
 * @file WorkbenchPage.tsx
 * @description 主题工作台页面，按主题管理项目并复用 Agent 对话与画布
 * @module components/workspace/WorkbenchPage
 */

import type { ProjectType } from "@/lib/api/project";
import type {
  Page,
  PageParams,
  WorkspaceTheme,
  WorkspaceViewMode,
} from "@/types/page";
import { WorkspaceShell, WorkspaceTopbar } from "@/components/workspace/shell";
import { WorkbenchCreateProjectDialog } from "@/components/workspace/dialogs";
import {
  WorkbenchLeftSidebar,
  WorkbenchMainContent,
  WorkbenchRightRail,
} from "@/components/workspace/panels";
import { useWorkbenchController } from "@/components/workspace/hooks/useWorkbenchController";

export interface WorkbenchPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  projectId?: string;
  contentId?: string;
  theme: WorkspaceTheme;
  viewMode?: WorkspaceViewMode;
  resetAt?: number;
  initialCreatePrompt?: string;
  initialCreateSource?: "workspace_prompt" | "quick_create" | "project_created";
  initialCreateFallbackTitle?: string;
}

export function WorkbenchPage({
  onNavigate,
  projectId: initialProjectId,
  contentId: initialContentId,
  theme,
  viewMode: initialViewMode,
  resetAt,
  initialCreatePrompt,
  initialCreateSource,
  initialCreateFallbackTitle,
}: WorkbenchPageProps) {
  const {
    themeModule,
    leftSidebarCollapsed,
    toggleLeftSidebar,
    setWorkflowProgress,
    setCurrentChatSessionId,
    workspaceMode,
    activeWorkspaceView,
    setCreateProjectDialogOpen,
    setNewProjectName,
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
    newProjectName,
    workspaceProjectsRoot,
    creatingProject,
    pendingInitialPromptsByContentId,
    pendingCreateConfirmation,
    resolvedProjectPath,
    pathChecking,
    pathConflictMessage,
    projectTypeLabel,
    shouldRenderLeftSidebar,
    isCreateWorkspaceView,
    showCreateContentEntryHome,
    shouldRenderWorkspaceRightRail,
    activeWorkspaceViewLabel,
    currentContentTitle,
    ActivePanelRenderer,
    PrimaryWorkspaceRenderer,
    handleEnterWorkspace,
    handleSelectProjectAndEnterWorkspace,
    handleOpenWorkflowView,
    loadProjects,
    handleOpenCreateProjectDialog,
    handleCreateProject,
    handleOpenCreateContentDialog,
    handleCreateContentFromWorkspacePrompt,
    handleSubmitCreateConfirmation,
    handleCancelCreateConfirmation,
    consumePendingInitialPrompt,
    handleBackHome,
    handleOpenCreateHome,
    handleBackToProjectManagement,
    handleEnterWorkspaceView,
    handleSwitchWorkspaceView,
    selectedProjectForContentActions,
    creationModes,
    creationTypes,
  } = useWorkbenchController({
    onNavigate,
    initialProjectId,
    initialContentId,
    theme,
    initialViewMode,
    resetAt,
    initialCreatePrompt,
    initialCreateSource,
    initialCreateFallbackTitle,
  });

  const selectedCreationMode = selectedContentId
    ? creationModes[selectedContentId]
    : undefined;
  const selectedCreationType = selectedContentId
    ? creationTypes[selectedContentId]
    : undefined;
  const shouldHideVideoSidebarInWorkspace =
    themeModule.capabilities.workspaceKind === "video-canvas" &&
    workspaceMode === "workspace";
  const shouldHideVideoRightRailInWorkspace =
    themeModule.capabilities.workspaceKind === "video-canvas" &&
    workspaceMode === "workspace";

  return (
    <div className="flex flex-col h-full min-h-0">
      <WorkspaceShell
        header={
          <WorkspaceTopbar
            theme={theme as ProjectType}
            projectName={selectedProject?.name}
            navigationItems={
              workspaceMode === "workspace" ? themeModule.navigation.items : []
            }
            activeView={activeWorkspaceView}
            onViewChange={handleSwitchWorkspaceView}
            onBackHome={handleBackHome}
            onOpenCreateHome={handleOpenCreateHome}
            onBackToProjectManagement={handleBackToProjectManagement}
            showBackToProjectManagement={workspaceMode === "workspace"}
          />
        }
        leftSidebar={
          <WorkbenchLeftSidebar
            shouldRender={
              shouldRenderLeftSidebar && !shouldHideVideoSidebarInWorkspace
            }
            leftSidebarCollapsed={leftSidebarCollapsed}
            theme={theme as ProjectType}
            projectsLoading={projectsLoading}
            filteredProjects={filteredProjects}
            selectedProjectId={selectedProjectId}
            projectQuery={projectQuery}
            onProjectQueryChange={setProjectQuery}
            onReloadProjects={() => {
              void loadProjects();
            }}
            onOpenCreateProjectDialog={handleOpenCreateProjectDialog}
            onToggleLeftSidebar={toggleLeftSidebar}
            onSelectProject={handleSelectProjectAndEnterWorkspace}
            isCreateWorkspaceView={isCreateWorkspaceView}
            selectedContentId={selectedContentId}
            currentContentTitle={currentContentTitle}
            activeWorkspaceViewLabel={activeWorkspaceViewLabel}
            selectedProjectForContentActions={selectedProjectForContentActions}
            onOpenCreateContentDialog={handleOpenCreateContentDialog}
            contentQuery={contentQuery}
            onContentQueryChange={setContentQuery}
            contentsLoading={contentsLoading}
            filteredContents={filteredContents}
            onSelectContent={handleEnterWorkspace}
            onBackToCreateView={() => handleSwitchWorkspaceView("create")}
            onOpenCreateHome={handleOpenCreateHome}
          />
        }
        main={
          <WorkbenchMainContent
            workspaceMode={workspaceMode}
            selectedProjectId={selectedProjectId}
            selectedProject={selectedProject}
            navigationItems={themeModule.navigation.items}
            workspaceNotice={themeModule.capabilities.workspaceNotice}
            onOpenCreateProjectDialog={handleOpenCreateProjectDialog}
            onOpenCreateContentDialog={handleOpenCreateContentDialog}
            onEnterWorkspaceView={handleEnterWorkspaceView}
            activeWorkspaceView={activeWorkspaceView}
            primaryWorkspaceRenderer={PrimaryWorkspaceRenderer}
            selectedContentId={selectedContentId}
            resetAt={resetAt}
            onBackHome={handleBackHome}
            onOpenWorkflowView={handleOpenWorkflowView}
            onNavigate={onNavigate}
            theme={theme}
            pendingInitialPromptsByContentId={pendingInitialPromptsByContentId}
            pendingCreateConfirmation={pendingCreateConfirmation}
            onSubmitCreateConfirmation={(formData) => {
              void handleSubmitCreateConfirmation(formData);
            }}
            onCancelCreateConfirmation={handleCancelCreateConfirmation}
            onConsumePendingInitialPrompt={consumePendingInitialPrompt}
            creationModes={creationModes}
            showChatPanel={true}
            showCreateContentEntryHome={showCreateContentEntryHome}
            onWorkflowProgressChange={setWorkflowProgress}
            onChatSessionChange={setCurrentChatSessionId}
            activePanelRenderer={ActivePanelRenderer}
          />
        }
        rightRail={
          shouldHideVideoRightRailInWorkspace ? null : (
            <WorkbenchRightRail
              shouldRender={
                shouldRenderWorkspaceRightRail &&
                !(activeWorkspaceView === "create" && !selectedContentId)
              }
              isCreateWorkspaceView={isCreateWorkspaceView}
              projectId={selectedProjectId}
              contentId={selectedContentId}
              theme={theme}
              creationMode={selectedCreationMode}
              creationType={selectedCreationType}
              onBackToCreateView={() => handleSwitchWorkspaceView("create")}
              onCreateContentFromPrompt={handleCreateContentFromWorkspacePrompt}
            />
          )
        }
      />

      <WorkbenchCreateProjectDialog
        open={createProjectDialogOpen}
        creatingProject={creatingProject}
        newProjectName={newProjectName}
        projectTypeLabel={projectTypeLabel}
        workspaceProjectsRoot={workspaceProjectsRoot}
        resolvedProjectPath={resolvedProjectPath}
        pathChecking={pathChecking}
        pathConflictMessage={pathConflictMessage}
        onOpenChange={(open) => {
          if (!creatingProject) {
            setCreateProjectDialogOpen(open);
          }
        }}
        onProjectNameChange={setNewProjectName}
        onCreateProject={() => {
          void handleCreateProject();
        }}
      />
    </div>
  );
}

export default WorkbenchPage;
