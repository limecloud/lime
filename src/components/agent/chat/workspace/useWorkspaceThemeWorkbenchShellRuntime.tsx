import { useWorkspaceContextHarnessRuntime } from "./useWorkspaceContextHarnessRuntime";
import { useWorkspaceHarnessInventoryRuntime } from "./useWorkspaceHarnessInventoryRuntime";
import { useWorkspaceThemeWorkbenchScaffoldRuntime } from "./useWorkspaceThemeWorkbenchScaffoldRuntime";
import { useWorkspaceThemeWorkbenchSidebarRuntime } from "./useWorkspaceThemeWorkbenchSidebarRuntime";
import { useThemeWorkbenchSidebarPresentation } from "./useThemeWorkbenchSidebarPresentation";

type ThemeWorkbenchSidebarPresentationParams = Parameters<
  typeof useThemeWorkbenchSidebarPresentation
>[0];
type ThemeWorkbenchSidebarHistory = NonNullable<
  ThemeWorkbenchSidebarPresentationParams["sidebar"]["history"]
>;
type ContextHarnessRuntime = ReturnType<typeof useWorkspaceContextHarnessRuntime>;
type HarnessInventoryRuntime = ReturnType<
  typeof useWorkspaceHarnessInventoryRuntime
>;
type ThemeWorkbenchScaffoldRuntime = ReturnType<
  typeof useWorkspaceThemeWorkbenchScaffoldRuntime
>;
type ThemeWorkbenchSidebarRuntime = ReturnType<
  typeof useWorkspaceThemeWorkbenchSidebarRuntime
>;

interface UseWorkspaceThemeWorkbenchShellRuntimeParams {
  showChatPanel: ThemeWorkbenchSidebarPresentationParams["showChatPanel"];
  showSidebar: ThemeWorkbenchSidebarPresentationParams["showSidebar"];
  hasPendingA2UIForm: ThemeWorkbenchSidebarPresentationParams["hasPendingA2UIForm"];
  contextHarnessRuntime: ContextHarnessRuntime;
  themeWorkbenchScaffoldRuntime: ThemeWorkbenchScaffoldRuntime;
  themeWorkbenchSidebarRuntime: ThemeWorkbenchSidebarRuntime;
  harnessInventoryRuntime: HarnessInventoryRuntime;
  handleCreateVersionSnapshot: ThemeWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onCreateVersionSnapshot"];
  handleSwitchBranchVersion: ThemeWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onSwitchBranchVersion"];
  handleSetBranchStatus: ThemeWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onSetBranchStatus"];
  handleAddImage: ThemeWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onAddImage"];
  handleImportDocument: ThemeWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onImportDocument"];
  handleViewContextDetail: ThemeWorkbenchSidebarPresentationParams["sidebar"]["onViewContextDetail"];
  messages: ThemeWorkbenchSidebarHistory["messages"];
  harnessState: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["harnessState"];
  compatSubagentRuntime: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["compatSubagentRuntime"];
  childSubagentSessions: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["childSubagentSessions"];
  selectedTeamLabel: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["selectedTeamLabel"];
  selectedTeamSummary: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["selectedTeamSummary"];
  selectedTeamRoles: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["selectedTeamRoles"];
  teamMemorySnapshot: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["teamMemorySnapshot"];
  handleOpenSubagentSession: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["onOpenSubagentSession"];
  handleHarnessLoadFilePreview: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["onLoadFilePreview"];
  handleFileClick: ThemeWorkbenchSidebarPresentationParams["harnessDialog"]["onOpenFile"];
}

export function useWorkspaceThemeWorkbenchShellRuntime({
  showChatPanel,
  showSidebar,
  hasPendingA2UIForm,
  contextHarnessRuntime,
  themeWorkbenchScaffoldRuntime,
  themeWorkbenchSidebarRuntime,
  harnessInventoryRuntime,
  handleCreateVersionSnapshot,
  handleSwitchBranchVersion,
  handleSetBranchStatus,
  handleAddImage,
  handleImportDocument,
  handleViewContextDetail,
  messages,
  harnessState,
  compatSubagentRuntime,
  childSubagentSessions,
  selectedTeamLabel,
  selectedTeamSummary,
  selectedTeamRoles,
  teamMemorySnapshot,
  handleOpenSubagentSession,
  handleHarnessLoadFilePreview,
  handleFileClick,
}: UseWorkspaceThemeWorkbenchShellRuntimeParams) {
  return useThemeWorkbenchSidebarPresentation({
    showChatPanel,
    showSidebar,
    hasPendingA2UIForm,
    isThemeWorkbench: contextHarnessRuntime.isThemeWorkbench,
    shouldUseCompactThemeWorkbench:
      themeWorkbenchScaffoldRuntime.shouldUseCompactThemeWorkbench,
    enablePanelCollapse:
      themeWorkbenchScaffoldRuntime.enableThemeWorkbenchPanelCollapse,
    sidebarCollapsed: themeWorkbenchScaffoldRuntime.themeWorkbenchSidebarCollapsed,
    onSidebarCollapsedChange:
      themeWorkbenchScaffoldRuntime.setThemeWorkbenchSidebarCollapsed,
    sidebar: {
      themeWorkbenchHarnessSummary:
        harnessInventoryRuntime.themeWorkbenchHarnessSummary,
      harnessPanelVisible: contextHarnessRuntime.harnessPanelVisible,
      onToggleHarnessPanel: contextHarnessRuntime.handleToggleHarnessPanel,
      workflow: {
        branchItems: themeWorkbenchScaffoldRuntime.branchItems,
        onCreateVersionSnapshot: handleCreateVersionSnapshot,
        onSwitchBranchVersion: handleSwitchBranchVersion,
        onSetBranchStatus: handleSetBranchStatus,
        workflowSteps: themeWorkbenchSidebarRuntime.themeWorkbenchWorkflowSteps,
        onAddImage: handleAddImage,
        onImportDocument: handleImportDocument,
        activityLogs: themeWorkbenchSidebarRuntime.themeWorkbenchActivityLogs,
        creationTaskEvents:
          themeWorkbenchScaffoldRuntime.themeWorkbenchCreationTaskEvents,
        onViewRunDetail:
          themeWorkbenchSidebarRuntime.handleViewThemeWorkbenchRunDetail,
        activeRunDetail:
          themeWorkbenchSidebarRuntime.selectedThemeWorkbenchRunDetail,
        activeRunDetailLoading:
          themeWorkbenchSidebarRuntime.themeWorkbenchRunDetailLoading,
      },
      contextWorkspace: contextHarnessRuntime.contextWorkspace,
      onViewContextDetail: handleViewContextDetail,
      history: {
        hasMore: themeWorkbenchSidebarRuntime.themeWorkbenchHistoryHasMore,
        loading: themeWorkbenchSidebarRuntime.themeWorkbenchHistoryLoading,
        onLoadMore:
          themeWorkbenchSidebarRuntime.handleLoadMoreThemeWorkbenchHistory,
        skillDetailMap: themeWorkbenchSidebarRuntime.themeWorkbenchSkillDetailMap,
        messages,
      },
    },
    harnessDialog: {
      enabled:
        contextHarnessRuntime.workbenchEnabled &&
        contextHarnessRuntime.isThemeWorkbench,
      open: contextHarnessRuntime.harnessPanelVisible,
      onOpenChange: contextHarnessRuntime.setHarnessPanelVisible,
      harnessState,
      compatSubagentRuntime,
      environment: contextHarnessRuntime.harnessEnvironment,
      childSubagentSessions,
      selectedTeamLabel,
      selectedTeamSummary,
      selectedTeamRoles,
      teamMemorySnapshot,
      toolInventory: harnessInventoryRuntime.toolInventory,
      toolInventoryLoading: harnessInventoryRuntime.toolInventoryLoading,
      toolInventoryError: harnessInventoryRuntime.toolInventoryError,
      onRefreshToolInventory: harnessInventoryRuntime.refreshToolInventory,
      onOpenSubagentSession: handleOpenSubagentSession,
      onLoadFilePreview: handleHarnessLoadFilePreview,
      onOpenFile: handleFileClick,
    },
  });
}
