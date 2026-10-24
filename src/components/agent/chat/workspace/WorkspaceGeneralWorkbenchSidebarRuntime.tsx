import type { ComponentProps, ReactNode } from "react";
import type { Message } from "../types";
import { WorkspaceGeneralWorkbenchSidebar } from "./WorkspaceGeneralWorkbenchSidebar";
import type { useWorkspaceGeneralWorkbenchScaffoldRuntime } from "./useWorkspaceGeneralWorkbenchScaffoldRuntime";
import type { useWorkspaceGeneralWorkbenchSidebarRuntime } from "./useWorkspaceGeneralWorkbenchSidebarRuntime";

type WorkspaceGeneralWorkbenchSidebarProps = ComponentProps<
  typeof WorkspaceGeneralWorkbenchSidebar
>;
type GeneralWorkbenchSidebarWorkflowProps =
  WorkspaceGeneralWorkbenchSidebarProps["workflow"];
type GeneralWorkbenchScaffoldRuntime = Pick<
  ReturnType<typeof useWorkspaceGeneralWorkbenchScaffoldRuntime>,
  | "branchItems"
  | "enableGeneralWorkbenchPanelCollapse"
  | "generalWorkbenchCreationTaskEvents"
>;
type GeneralWorkbenchSidebarRuntime = Pick<
  ReturnType<typeof useWorkspaceGeneralWorkbenchSidebarRuntime>,
  | "generalWorkbenchActivityLogs"
  | "generalWorkbenchHistoryHasMore"
  | "generalWorkbenchHistoryLoading"
  | "generalWorkbenchRunDetailLoading"
  | "generalWorkbenchSkillDetailMap"
  | "generalWorkbenchWorkflowControlItems"
  | "generalWorkbenchWorkflowControlPendingItemId"
  | "generalWorkbenchWorkflowSteps"
  | "handleLoadMoreGeneralWorkbenchHistory"
  | "handleTriggerGeneralWorkbenchWorkflowControl"
  | "handleViewGeneralWorkbenchRunDetail"
  | "selectedGeneralWorkbenchRunDetail"
>;

export interface RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams {
  generalWorkbenchHarnessSummary: WorkspaceGeneralWorkbenchSidebarProps["generalWorkbenchHarnessSummary"];
  generalWorkbenchScaffoldRuntime: GeneralWorkbenchScaffoldRuntime;
  generalWorkbenchSidebarRuntime: GeneralWorkbenchSidebarRuntime;
  harnessPanelVisible: boolean;
  isThemeWorkbench: boolean;
  messages: Message[];
  projectId?: GeneralWorkbenchSidebarWorkflowProps["projectId"];
  sessionId?: GeneralWorkbenchSidebarWorkflowProps["sessionId"];
  visible: boolean;
  onAddImage: GeneralWorkbenchSidebarWorkflowProps["onAddImage"];
  onApplyFollowUpAction: GeneralWorkbenchSidebarWorkflowProps["onApplyFollowUpAction"];
  onCreateVersionSnapshot: GeneralWorkbenchSidebarWorkflowProps["onCreateVersionSnapshot"];
  onDeleteTopic: GeneralWorkbenchSidebarWorkflowProps["onDeleteTopic"];
  onImportDocument: GeneralWorkbenchSidebarWorkflowProps["onImportDocument"];
  onRequestCollapse: WorkspaceGeneralWorkbenchSidebarProps["onRequestCollapse"];
  onSetBranchStatus: GeneralWorkbenchSidebarWorkflowProps["onSetBranchStatus"];
  onSwitchBranchVersion: GeneralWorkbenchSidebarWorkflowProps["onSwitchBranchVersion"];
  onToggleHarnessPanel: WorkspaceGeneralWorkbenchSidebarProps["onToggleHarnessPanel"];
}

export function renderWorkspaceGeneralWorkbenchSidebarRuntime({
  generalWorkbenchHarnessSummary,
  generalWorkbenchScaffoldRuntime,
  generalWorkbenchSidebarRuntime,
  harnessPanelVisible,
  isThemeWorkbench,
  messages,
  projectId,
  sessionId,
  visible,
  onAddImage,
  onApplyFollowUpAction,
  onCreateVersionSnapshot,
  onDeleteTopic,
  onImportDocument,
  onRequestCollapse,
  onSetBranchStatus,
  onSwitchBranchVersion,
  onToggleHarnessPanel,
}: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams): ReactNode {
  return (
    <WorkspaceGeneralWorkbenchSidebar
      visible={visible}
      isThemeWorkbench={isThemeWorkbench}
      enablePanelCollapse={
        generalWorkbenchScaffoldRuntime.enableGeneralWorkbenchPanelCollapse
      }
      onRequestCollapse={onRequestCollapse}
      generalWorkbenchHarnessSummary={generalWorkbenchHarnessSummary}
      harnessPanelVisible={harnessPanelVisible}
      onToggleHarnessPanel={onToggleHarnessPanel}
      workflow={{
        projectId,
        sessionId,
        branchItems: generalWorkbenchScaffoldRuntime.branchItems,
        onCreateVersionSnapshot,
        onSwitchBranchVersion,
        onDeleteTopic,
        onSetBranchStatus,
        workflowSteps:
          generalWorkbenchSidebarRuntime.generalWorkbenchWorkflowSteps,
        onAddImage,
        onImportDocument,
        onApplyFollowUpAction,
        activityLogs:
          generalWorkbenchSidebarRuntime.generalWorkbenchActivityLogs,
        creationTaskEvents:
          generalWorkbenchScaffoldRuntime.generalWorkbenchCreationTaskEvents,
        onViewRunDetail:
          generalWorkbenchSidebarRuntime.handleViewGeneralWorkbenchRunDetail,
        activeRunDetail:
          generalWorkbenchSidebarRuntime.selectedGeneralWorkbenchRunDetail,
        activeRunDetailLoading:
          generalWorkbenchSidebarRuntime.generalWorkbenchRunDetailLoading,
        workflowControlItems:
          generalWorkbenchSidebarRuntime.generalWorkbenchWorkflowControlItems,
        workflowControlPendingItemId:
          generalWorkbenchSidebarRuntime.generalWorkbenchWorkflowControlPendingItemId,
        onTriggerWorkflowControl:
          generalWorkbenchSidebarRuntime.handleTriggerGeneralWorkbenchWorkflowControl,
      }}
      history={{
        hasMore: generalWorkbenchSidebarRuntime.generalWorkbenchHistoryHasMore,
        loading: generalWorkbenchSidebarRuntime.generalWorkbenchHistoryLoading,
        onLoadMore:
          generalWorkbenchSidebarRuntime.handleLoadMoreGeneralWorkbenchHistory,
        skillDetailMap:
          generalWorkbenchSidebarRuntime.generalWorkbenchSkillDetailMap,
        messages,
      }}
    />
  );
}
