import type { GeneralWorkbenchSidebarTab } from "./GeneralWorkbenchSidebarShell";
import type { GeneralWorkbenchSidebarContentProps } from "./generalWorkbenchSidebarContentContract";
import type { GeneralWorkbenchSidebarOrchestrationInput } from "./generalWorkbenchSidebarOrchestrationContract";
import { buildGeneralWorkbenchContextPanelProps } from "./buildGeneralWorkbenchContextPanelProps";
import { buildGeneralWorkbenchExecLogProps } from "./buildGeneralWorkbenchExecLogProps";
import { buildGeneralWorkbenchWorkflowPanelProps } from "./buildGeneralWorkbenchWorkflowPanelProps";
import { useGeneralWorkbenchArtifactActions } from "./useGeneralWorkbenchArtifactActions";
import { useGeneralWorkbenchContextPanelState } from "./useGeneralWorkbenchContextPanelState";
import { useGeneralWorkbenchExecLogState } from "./useGeneralWorkbenchExecLogState";
import { useGeneralWorkbenchSidebarTelemetry } from "./useGeneralWorkbenchSidebarTelemetry";
import { useGeneralWorkbenchWorkflowPanelState } from "./useGeneralWorkbenchWorkflowPanelState";

interface UseGeneralWorkbenchSidebarOrchestrationParams {
  activeTab: GeneralWorkbenchSidebarTab;
  input: GeneralWorkbenchSidebarOrchestrationInput;
}

export interface GeneralWorkbenchSidebarOrchestration {
  workflowCount: number;
  isVersionMode: boolean;
  activeContextCount: number;
  visibleExecLogCount: number;
  contextPanelProps: GeneralWorkbenchSidebarContentProps["contextPanelProps"];
  workflowPanelProps: GeneralWorkbenchSidebarContentProps["workflowPanelProps"];
  execLogProps: GeneralWorkbenchSidebarContentProps["execLogProps"];
}

export function useGeneralWorkbenchSidebarOrchestration({
  activeTab,
  input,
}: UseGeneralWorkbenchSidebarOrchestrationParams): GeneralWorkbenchSidebarOrchestration {
  const { isVersionMode, context, workflow, execLog } = input;
  const branchCount = workflow.branchItems.length;
  const workflowCount = workflow.workflowSteps.filter(
    (step) => step.status !== "completed" && step.status !== "skipped",
  ).length;
  const runDetailSessionId =
    workflow.activeRunDetail?.session_id?.trim() || null;
  const { handleRevealArtifactInFinder, handleOpenArtifactWithDefaultApp } =
    useGeneralWorkbenchArtifactActions({
      runDetailSessionId,
    });

  const workflowPanelState = useGeneralWorkbenchWorkflowPanelState({
    workflowSteps: workflow.workflowSteps,
    activityLogs: workflow.activityLogs,
    creationTaskEvents: workflow.creationTaskEvents,
    activeRunMetadata: workflow.activeRunDetail?.metadata ?? null,
  });

  const contextPanelState = useGeneralWorkbenchContextPanelState({
    contextItems: context.contextItems,
    contextSearchQuery: context.contextSearchQuery,
    contextSearchLoading: context.contextSearchLoading,
    contextSearchBlockedReason: context.contextSearchBlockedReason,
    onAddTextContext: context.onAddTextContext,
    onAddLinkContext: context.onAddLinkContext,
    onAddFileContext: context.onAddFileContext,
  });

  useGeneralWorkbenchSidebarTelemetry({
    activeTab,
    showActivityLogs: workflowPanelState.showActivityLogs,
    contextSearchLoading: context.contextSearchLoading,
    branchItemsCount: branchCount,
    workflowStepsCount: workflow.workflowSteps.length,
    contextItemsCount: context.contextItems.length,
    activeContextCount: contextPanelState.activeContextItems.length,
    activityLogsCount: workflow.activityLogs.length,
    creationTaskEventsCount: workflow.creationTaskEvents.length,
    hasActiveRunDetail: Boolean(workflow.activeRunDetail),
  });

  const execLogState = useGeneralWorkbenchExecLogState({
    messages: execLog.messages,
    groupedActivityLogs: workflowPanelState.groupedActivityLogs,
    groupedCreationTaskEvents: workflowPanelState.groupedCreationTaskEvents,
    skillDetailMap: execLog.skillDetailMap,
  });

  return {
    workflowCount,
    isVersionMode,
    activeContextCount: contextPanelState.activeContextItems.length,
    visibleExecLogCount: execLogState.visibleExecLogEntries.length,
    contextPanelProps: buildGeneralWorkbenchContextPanelProps({
      contextBudget: context.contextBudget,
      contextItems: context.contextItems,
      contextPanelState,
      contextSearchBlockedReason: context.contextSearchBlockedReason,
      contextSearchError: context.contextSearchError,
      contextSearchLoading: context.contextSearchLoading,
      contextSearchMode: context.contextSearchMode,
      contextSearchQuery: context.contextSearchQuery,
      onContextSearchModeChange: context.onContextSearchModeChange,
      onContextSearchQueryChange: context.onContextSearchQueryChange,
      onSubmitContextSearch: context.onSubmitContextSearch,
      onToggleContextActive: context.onToggleContextActive,
      onViewContextDetail: context.onViewContextDetail,
    }),
    workflowPanelProps: buildGeneralWorkbenchWorkflowPanelProps({
      isVersionMode,
      branchItems: workflow.branchItems,
      creationTaskEventsCount: workflow.creationTaskEvents.length,
      projectId: workflow.projectId,
      sessionId: workflow.sessionId,
      onAddImage: workflow.onAddImage,
      onApplyFollowUpAction: workflow.onApplyFollowUpAction,
      onDeleteTopic: workflow.onDeleteTopic,
      onImportDocument: workflow.onImportDocument,
      onNewTopic: workflow.onNewTopic,
      onOpenArtifactWithDefaultApp: handleOpenArtifactWithDefaultApp,
      onRevealArtifactInFinder: handleRevealArtifactInFinder,
      onSetBranchStatus: workflow.onSetBranchStatus,
      onSwitchTopic: workflow.onSwitchTopic,
      onViewRunDetail: workflow.onViewRunDetail,
      workflowPanelState,
      workflowSteps: workflow.workflowSteps,
      activeRunDetail: workflow.activeRunDetail,
      activeRunDetailLoading: workflow.activeRunDetailLoading,
    }),
    execLogProps: buildGeneralWorkbenchExecLogProps({
      execLogState,
      historyHasMore: execLog.historyHasMore,
      historyLoading: execLog.historyLoading,
      onLoadMoreHistory: execLog.onLoadMoreHistory,
    }),
  };
}
