import type { GeneralWorkbenchSidebarExecLogProps } from "./generalWorkbenchSidebarContentContract";
import type { GeneralWorkbenchExecLogState } from "./useGeneralWorkbenchExecLogState";

export interface BuildGeneralWorkbenchExecLogPropsParams {
  execLogState: GeneralWorkbenchExecLogState;
  historyHasMore?: GeneralWorkbenchSidebarExecLogProps["historyHasMore"];
  historyLoading?: GeneralWorkbenchSidebarExecLogProps["historyLoading"];
  onLoadMoreHistory?: GeneralWorkbenchSidebarExecLogProps["onLoadMoreHistory"];
}

export function buildGeneralWorkbenchExecLogProps({
  execLogState,
  historyHasMore = false,
  historyLoading = false,
  onLoadMoreHistory,
}: BuildGeneralWorkbenchExecLogPropsParams): GeneralWorkbenchSidebarExecLogProps {
  return {
    entries: execLogState.visibleExecLogEntries,
    totalEntriesCount: execLogState.execLogEntries.length,
    wasCleared: execLogState.wasExecLogCleared,
    onClear: execLogState.clearExecLog,
    onLoadMoreHistory,
    historyHasMore,
    historyLoading,
  };
}
