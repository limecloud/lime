import type {
  GeneralWorkbenchSidebarContextContract,
  GeneralWorkbenchSidebarExecLogContract,
  GeneralWorkbenchSidebarProps,
  GeneralWorkbenchSidebarShellContract,
  GeneralWorkbenchSidebarWorkflowContract,
} from "./generalWorkbenchSidebarContract";

function areGeneralWorkbenchContextBudgetsEqual(
  previous: GeneralWorkbenchSidebarProps["contextBudget"],
  next: GeneralWorkbenchSidebarProps["contextBudget"],
): boolean {
  return (
    previous.activeCount === next.activeCount &&
    previous.activeCountLimit === next.activeCountLimit &&
    previous.estimatedTokens === next.estimatedTokens &&
    previous.tokenLimit === next.tokenLimit
  );
}

function areGeneralWorkbenchSidebarShellPropsEqual(
  previous: GeneralWorkbenchSidebarShellContract,
  next: GeneralWorkbenchSidebarShellContract,
): boolean {
  return (
    previous.branchMode === next.branchMode &&
    previous.onRequestCollapse === next.onRequestCollapse &&
    previous.headerActionSlot === next.headerActionSlot &&
    previous.topSlot === next.topSlot
  );
}

function areGeneralWorkbenchSidebarContextPropsEqual(
  previous: GeneralWorkbenchSidebarContextContract,
  next: GeneralWorkbenchSidebarContextContract,
): boolean {
  return (
    previous.contextSearchQuery === next.contextSearchQuery &&
    previous.onContextSearchQueryChange === next.onContextSearchQueryChange &&
    previous.contextSearchMode === next.contextSearchMode &&
    previous.onContextSearchModeChange === next.onContextSearchModeChange &&
    previous.contextSearchLoading === next.contextSearchLoading &&
    previous.contextSearchError === next.contextSearchError &&
    previous.contextSearchBlockedReason === next.contextSearchBlockedReason &&
    previous.onSubmitContextSearch === next.onSubmitContextSearch &&
    previous.onAddTextContext === next.onAddTextContext &&
    previous.onAddLinkContext === next.onAddLinkContext &&
    previous.onAddFileContext === next.onAddFileContext &&
    previous.contextItems === next.contextItems &&
    previous.onToggleContextActive === next.onToggleContextActive &&
    previous.onViewContextDetail === next.onViewContextDetail &&
    areGeneralWorkbenchContextBudgetsEqual(
      previous.contextBudget,
      next.contextBudget,
    )
  );
}

function areGeneralWorkbenchSidebarWorkflowPropsEqual(
  previous: GeneralWorkbenchSidebarWorkflowContract,
  next: GeneralWorkbenchSidebarWorkflowContract,
): boolean {
  return (
    previous.onNewTopic === next.onNewTopic &&
    previous.onSwitchTopic === next.onSwitchTopic &&
    previous.onDeleteTopic === next.onDeleteTopic &&
    previous.branchItems === next.branchItems &&
    previous.onSetBranchStatus === next.onSetBranchStatus &&
    previous.workflowSteps === next.workflowSteps &&
    previous.onAddImage === next.onAddImage &&
    previous.onImportDocument === next.onImportDocument &&
    previous.activityLogs === next.activityLogs &&
    previous.creationTaskEvents === next.creationTaskEvents &&
    previous.onViewRunDetail === next.onViewRunDetail &&
    previous.activeRunDetail === next.activeRunDetail &&
    previous.activeRunDetailLoading === next.activeRunDetailLoading
  );
}

function areGeneralWorkbenchSidebarExecLogPropsEqual(
  previous: GeneralWorkbenchSidebarExecLogContract,
  next: GeneralWorkbenchSidebarExecLogContract,
): boolean {
  return (
    previous.historyHasMore === next.historyHasMore &&
    previous.historyLoading === next.historyLoading &&
    previous.onLoadMoreHistory === next.onLoadMoreHistory &&
    previous.skillDetailMap === next.skillDetailMap &&
    previous.messages === next.messages
  );
}

export function areGeneralWorkbenchSidebarPropsEqual(
  previous: GeneralWorkbenchSidebarProps,
  next: GeneralWorkbenchSidebarProps,
): boolean {
  return (
    areGeneralWorkbenchSidebarShellPropsEqual(previous, next) &&
    areGeneralWorkbenchSidebarContextPropsEqual(previous, next) &&
    areGeneralWorkbenchSidebarWorkflowPropsEqual(previous, next) &&
    areGeneralWorkbenchSidebarExecLogPropsEqual(previous, next)
  );
}
