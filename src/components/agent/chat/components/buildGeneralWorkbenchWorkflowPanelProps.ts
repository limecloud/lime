import type { GeneralWorkbenchSidebarWorkflowPanelProps } from "./generalWorkbenchSidebarContentContract";
import { writeGeneralWorkbenchClipboardText } from "./generalWorkbenchSidebarShared";
import type { GeneralWorkbenchWorkflowPanelState } from "./useGeneralWorkbenchWorkflowPanelState";

export interface BuildGeneralWorkbenchWorkflowPanelPropsParams {
  isVersionMode: GeneralWorkbenchSidebarWorkflowPanelProps["isVersionMode"];
  activeRunDetail: GeneralWorkbenchSidebarWorkflowPanelProps["activeRunDetail"];
  activeRunDetailLoading: GeneralWorkbenchSidebarWorkflowPanelProps["activeRunDetailLoading"];
  branchItems: GeneralWorkbenchSidebarWorkflowPanelProps["branchItems"];
  creationTaskEventsCount: GeneralWorkbenchSidebarWorkflowPanelProps["creationTaskEventsCount"];
  onAddImage?: GeneralWorkbenchSidebarWorkflowPanelProps["onAddImage"];
  onDeleteTopic: GeneralWorkbenchSidebarWorkflowPanelProps["onDeleteTopic"];
  onImportDocument?: GeneralWorkbenchSidebarWorkflowPanelProps["onImportDocument"];
  onNewTopic: GeneralWorkbenchSidebarWorkflowPanelProps["onNewTopic"];
  onOpenArtifactWithDefaultApp: (
    artifactPath: string,
    sessionId?: string | null,
  ) => Promise<void> | void;
  onRevealArtifactInFinder: (
    artifactPath: string,
    sessionId?: string | null,
  ) => Promise<void> | void;
  onSetBranchStatus: GeneralWorkbenchSidebarWorkflowPanelProps["onSetBranchStatus"];
  onSwitchTopic: GeneralWorkbenchSidebarWorkflowPanelProps["onSwitchTopic"];
  onViewRunDetail?: GeneralWorkbenchSidebarWorkflowPanelProps["onViewRunDetail"];
  workflowPanelState: GeneralWorkbenchWorkflowPanelState;
  workflowSteps: GeneralWorkbenchSidebarWorkflowPanelProps["workflowSteps"];
}

export function buildGeneralWorkbenchWorkflowPanelProps({
  isVersionMode,
  branchItems,
  creationTaskEventsCount,
  onAddImage,
  onDeleteTopic,
  onImportDocument,
  onNewTopic,
  onOpenArtifactWithDefaultApp,
  onRevealArtifactInFinder,
  onSetBranchStatus,
  onSwitchTopic,
  onViewRunDetail,
  workflowPanelState,
  workflowSteps,
  activeRunDetail,
  activeRunDetailLoading,
}: BuildGeneralWorkbenchWorkflowPanelPropsParams): GeneralWorkbenchSidebarWorkflowPanelProps {
  return {
    isVersionMode,
    onNewTopic,
    onSwitchTopic,
    onDeleteTopic,
    branchItems,
    onSetBranchStatus,
    workflowSteps,
    completedSteps: workflowPanelState.completedSteps,
    progressPercent: workflowPanelState.progressPercent,
    onAddImage,
    onImportDocument,
    creationTaskEventsCount,
    showCreationTasks: workflowPanelState.showCreationTasks,
    onToggleCreationTasks: workflowPanelState.toggleCreationTasks,
    groupedCreationTaskEvents: workflowPanelState.groupedCreationTaskEvents,
    showActivityLogs: workflowPanelState.showActivityLogs,
    onToggleActivityLogs: workflowPanelState.toggleActivityLogs,
    groupedActivityLogs: workflowPanelState.groupedActivityLogs,
    onViewRunDetail,
    activeRunDetail,
    activeRunDetailLoading,
    activeRunStagesLabel: workflowPanelState.activeRunStagesLabel,
    runMetadataText: workflowPanelState.runMetadataText,
    runMetadataSummary: workflowPanelState.runMetadataSummary,
    onCopyText: writeGeneralWorkbenchClipboardText,
    onRevealArtifactInFinder,
    onOpenArtifactWithDefaultApp,
  };
}
