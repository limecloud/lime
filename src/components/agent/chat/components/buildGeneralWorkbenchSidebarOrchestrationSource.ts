import type {
  GeneralWorkbenchSidebarContextContract,
  GeneralWorkbenchSidebarExecLogContract,
  GeneralWorkbenchSidebarWorkflowContract,
} from "./generalWorkbenchSidebarContract";
import type { GeneralWorkbenchSidebarOrchestrationSource } from "./generalWorkbenchSidebarOrchestrationContract";

type GeneralWorkbenchSidebarOrchestrationSourceProps =
  GeneralWorkbenchSidebarContextContract &
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
    context: {
      contextBudget: props.contextBudget,
      contextItems: props.contextItems,
      contextSearchBlockedReason: props.contextSearchBlockedReason,
      contextSearchError: props.contextSearchError,
      contextSearchLoading: props.contextSearchLoading,
      contextSearchMode: props.contextSearchMode,
      contextSearchQuery: props.contextSearchQuery,
      onAddFileContext: props.onAddFileContext,
      onAddLinkContext: props.onAddLinkContext,
      onAddTextContext: props.onAddTextContext,
      onContextSearchModeChange: props.onContextSearchModeChange,
      onContextSearchQueryChange: props.onContextSearchQueryChange,
      onSubmitContextSearch: props.onSubmitContextSearch,
      onToggleContextActive: props.onToggleContextActive,
      onViewContextDetail: props.onViewContextDetail,
    },
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
