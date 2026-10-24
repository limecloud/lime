import type {
  GeneralWorkbenchSidebarExecLogContract,
  GeneralWorkbenchSidebarWorkflowContract,
} from "./generalWorkbenchSidebarContract";
import type { GeneralWorkbenchSidebarOrchestrationSource } from "./generalWorkbenchSidebarOrchestrationContract";

type GeneralWorkbenchSidebarOrchestrationSourceProps =
  GeneralWorkbenchSidebarWorkflowContract &
    GeneralWorkbenchSidebarExecLogContract;

interface BuildGeneralWorkbenchSidebarOrchestrationSourceParams {
  isVersionMode: boolean;
  props: GeneralWorkbenchSidebarOrchestrationSourceProps;
}

export function buildGeneralWorkbenchSidebarOrchestrationSource({
  isVersionMode,
  props,
}: BuildGeneralWorkbenchSidebarOrchestrationSourceParams): GeneralWorkbenchSidebarOrchestrationSource {
  return {
    isVersionMode,
    workflow: {
      activeRunDetail: props.activeRunDetail,
      activeRunDetailLoading: props.activeRunDetailLoading,
      activityLogs: props.activityLogs,
      branchItems: props.branchItems,
      creationTaskEvents: props.creationTaskEvents,
      projectId: props.projectId,
      sessionId: props.sessionId,
      onAddImage: props.onAddImage,
      onApplyFollowUpAction: props.onApplyFollowUpAction,
      onDeleteTopic: props.onDeleteTopic,
      onImportDocument: props.onImportDocument,
      onNewTopic: props.onNewTopic,
      onSetBranchStatus: props.onSetBranchStatus,
      onSwitchTopic: props.onSwitchTopic,
      onViewRunDetail: props.onViewRunDetail,
      onTriggerWorkflowControl: props.onTriggerWorkflowControl,
      workflowControlItems: props.workflowControlItems,
      workflowControlPendingItemId: props.workflowControlPendingItemId,
      workflowSteps: props.workflowSteps,
    },
    execLog: {
      historyHasMore: props.historyHasMore,
      historyLoading: props.historyLoading,
      messages: props.messages,
      onLoadMoreHistory: props.onLoadMoreHistory,
      skillDetailMap: props.skillDetailMap,
    },
  };
}
