import { useWorkspaceContextHarnessRuntime } from "./useWorkspaceContextHarnessRuntime";
import { useWorkspaceHarnessInventoryRuntime } from "./useWorkspaceHarnessInventoryRuntime";
import { useWorkspaceGeneralWorkbenchScaffoldRuntime } from "./useWorkspaceGeneralWorkbenchScaffoldRuntime";
import { useWorkspaceGeneralWorkbenchSidebarRuntime } from "./useWorkspaceGeneralWorkbenchSidebarRuntime";
import { useGeneralWorkbenchSidebarPresentation } from "./useGeneralWorkbenchSidebarPresentation";

type GeneralWorkbenchSidebarPresentationParams = Parameters<
  typeof useGeneralWorkbenchSidebarPresentation
>[0];
type GeneralWorkbenchSidebarHistory = NonNullable<
  GeneralWorkbenchSidebarPresentationParams["sidebar"]["history"]
>;
type ContextHarnessRuntime = ReturnType<typeof useWorkspaceContextHarnessRuntime>;
type HarnessInventoryRuntime = ReturnType<
  typeof useWorkspaceHarnessInventoryRuntime
>;
type GeneralWorkbenchScaffoldRuntime = ReturnType<
  typeof useWorkspaceGeneralWorkbenchScaffoldRuntime
>;
type GeneralWorkbenchSidebarRuntime = ReturnType<
  typeof useWorkspaceGeneralWorkbenchSidebarRuntime
>;

interface UseWorkspaceGeneralWorkbenchShellRuntimeParams {
  showChatPanel: GeneralWorkbenchSidebarPresentationParams["showChatPanel"];
  showSidebar: GeneralWorkbenchSidebarPresentationParams["showSidebar"];
  hasPendingA2UIForm: GeneralWorkbenchSidebarPresentationParams["hasPendingA2UIForm"];
  contextHarnessRuntime: ContextHarnessRuntime;
  generalWorkbenchScaffoldRuntime: GeneralWorkbenchScaffoldRuntime;
  generalWorkbenchSidebarRuntime: GeneralWorkbenchSidebarRuntime;
  harnessInventoryRuntime: HarnessInventoryRuntime;
  handleCreateVersionSnapshot: GeneralWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onCreateVersionSnapshot"];
  handleSwitchBranchVersion: GeneralWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onSwitchBranchVersion"];
  handleSetBranchStatus: GeneralWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onSetBranchStatus"];
  handleAddImage: GeneralWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onAddImage"];
  handleImportDocument: GeneralWorkbenchSidebarPresentationParams["sidebar"]["workflow"]["onImportDocument"];
  handleViewContextDetail: GeneralWorkbenchSidebarPresentationParams["sidebar"]["onViewContextDetail"];
  messages: GeneralWorkbenchSidebarHistory["messages"];
  harnessState: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["harnessState"];
  compatSubagentRuntime: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["compatSubagentRuntime"];
  childSubagentSessions: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["childSubagentSessions"];
  selectedTeamLabel: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["selectedTeamLabel"];
  selectedTeamSummary: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["selectedTeamSummary"];
  selectedTeamRoles: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["selectedTeamRoles"];
  teamMemorySnapshot: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["teamMemorySnapshot"];
  handleOpenSubagentSession: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["onOpenSubagentSession"];
  handleHarnessLoadFilePreview: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["onLoadFilePreview"];
  handleFileClick: GeneralWorkbenchSidebarPresentationParams["harnessDialog"]["onOpenFile"];
}

export function useWorkspaceGeneralWorkbenchShellRuntime({
  showChatPanel,
  showSidebar,
  hasPendingA2UIForm,
  contextHarnessRuntime,
  generalWorkbenchScaffoldRuntime,
  generalWorkbenchSidebarRuntime,
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
}: UseWorkspaceGeneralWorkbenchShellRuntimeParams) {
  return useGeneralWorkbenchSidebarPresentation({
    showChatPanel,
    showSidebar,
    hasPendingA2UIForm,
    isThemeWorkbench: contextHarnessRuntime.isThemeWorkbench,
    shouldUseCompactGeneralWorkbench:
      generalWorkbenchScaffoldRuntime.shouldUseCompactGeneralWorkbench,
    enablePanelCollapse:
      generalWorkbenchScaffoldRuntime.enableGeneralWorkbenchPanelCollapse,
    sidebarCollapsed:
      generalWorkbenchScaffoldRuntime.generalWorkbenchSidebarCollapsed,
    onSidebarCollapsedChange:
      generalWorkbenchScaffoldRuntime.setGeneralWorkbenchSidebarCollapsed,
    sidebar: {
      generalWorkbenchHarnessSummary:
        harnessInventoryRuntime.generalWorkbenchHarnessSummary,
      harnessPanelVisible: contextHarnessRuntime.harnessPanelVisible,
      onToggleHarnessPanel: contextHarnessRuntime.handleToggleHarnessPanel,
      workflow: {
        branchItems: generalWorkbenchScaffoldRuntime.branchItems,
        onCreateVersionSnapshot: handleCreateVersionSnapshot,
        onSwitchBranchVersion: handleSwitchBranchVersion,
        onSetBranchStatus: handleSetBranchStatus,
        workflowSteps: generalWorkbenchSidebarRuntime.generalWorkbenchWorkflowSteps,
        onAddImage: handleAddImage,
        onImportDocument: handleImportDocument,
        activityLogs: generalWorkbenchSidebarRuntime.generalWorkbenchActivityLogs,
        creationTaskEvents:
          generalWorkbenchScaffoldRuntime.generalWorkbenchCreationTaskEvents,
        onViewRunDetail:
          generalWorkbenchSidebarRuntime.handleViewGeneralWorkbenchRunDetail,
        activeRunDetail:
          generalWorkbenchSidebarRuntime.selectedGeneralWorkbenchRunDetail,
        activeRunDetailLoading:
          generalWorkbenchSidebarRuntime.generalWorkbenchRunDetailLoading,
      },
      contextWorkspace: contextHarnessRuntime.contextWorkspace,
      onViewContextDetail: handleViewContextDetail,
      history: {
        hasMore: generalWorkbenchSidebarRuntime.generalWorkbenchHistoryHasMore,
        loading: generalWorkbenchSidebarRuntime.generalWorkbenchHistoryLoading,
        onLoadMore:
          generalWorkbenchSidebarRuntime.handleLoadMoreGeneralWorkbenchHistory,
        skillDetailMap:
          generalWorkbenchSidebarRuntime.generalWorkbenchSkillDetailMap,
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
