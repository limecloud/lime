import type { GeneralWorkbenchSidebarContextPanelProps } from "./generalWorkbenchSidebarContentContract";
import type { GeneralWorkbenchContextPanelState } from "./useGeneralWorkbenchContextPanelState";

export interface BuildGeneralWorkbenchContextPanelPropsParams {
  contextPanelState: GeneralWorkbenchContextPanelState;
  contextBudget: GeneralWorkbenchSidebarContextPanelProps["contextBudget"];
  contextItems: GeneralWorkbenchSidebarContextPanelProps["contextItems"];
  contextSearchBlockedReason?: GeneralWorkbenchSidebarContextPanelProps["contextSearchBlockedReason"];
  contextSearchError?: GeneralWorkbenchSidebarContextPanelProps["contextSearchError"];
  contextSearchLoading: GeneralWorkbenchSidebarContextPanelProps["contextSearchLoading"];
  contextSearchMode: GeneralWorkbenchSidebarContextPanelProps["contextSearchMode"];
  contextSearchQuery: GeneralWorkbenchSidebarContextPanelProps["contextSearchQuery"];
  onContextSearchModeChange: GeneralWorkbenchSidebarContextPanelProps["onContextSearchModeChange"];
  onContextSearchQueryChange: GeneralWorkbenchSidebarContextPanelProps["onContextSearchQueryChange"];
  onSubmitContextSearch: GeneralWorkbenchSidebarContextPanelProps["onSubmitContextSearch"];
  onToggleContextActive: GeneralWorkbenchSidebarContextPanelProps["onToggleContextActive"];
  onViewContextDetail?: GeneralWorkbenchSidebarContextPanelProps["onViewContextDetail"];
}

export function buildGeneralWorkbenchContextPanelProps({
  contextBudget,
  contextItems,
  contextPanelState,
  contextSearchBlockedReason,
  contextSearchError,
  contextSearchLoading,
  contextSearchMode,
  contextSearchQuery,
  onContextSearchModeChange,
  onContextSearchQueryChange,
  onSubmitContextSearch,
  onToggleContextActive,
  onViewContextDetail,
}: BuildGeneralWorkbenchContextPanelPropsParams): GeneralWorkbenchSidebarContextPanelProps {
  return {
    contextItems,
    searchContextItems: contextPanelState.searchContextItems,
    orderedContextItems: contextPanelState.orderedContextItems,
    selectedSearchResult: contextPanelState.selectedSearchResult,
    latestSearchLabel: contextPanelState.latestSearchLabel,
    contextBudget,
    contextSearchQuery,
    contextSearchMode,
    contextSearchLoading,
    contextSearchError,
    contextSearchBlockedReason,
    isSearchActionDisabled: contextPanelState.isSearchActionDisabled,
    searchInputRef: contextPanelState.searchInputRef,
    onContextSearchQueryChange,
    onContextSearchModeChange,
    onSubmitContextSearch,
    onOpenAddContextDialog: contextPanelState.openAddContextDialog,
    onSelectSearchResult: contextPanelState.handleSelectSearchResult,
    onToggleContextActive,
    onViewContextDetail,
    addContextDialogOpen: contextPanelState.addContextDialogOpen,
    addTextDialogOpen: contextPanelState.addTextDialogOpen,
    addLinkDialogOpen: contextPanelState.addLinkDialogOpen,
    contextDraftText: contextPanelState.contextDraftText,
    contextDraftLink: contextPanelState.contextDraftLink,
    contextCreateLoading: contextPanelState.contextCreateLoading,
    contextCreateError: contextPanelState.contextCreateError,
    contextDropActive: contextPanelState.contextDropActive,
    onCloseAllContextDialogs: contextPanelState.closeAllContextDialogs,
    onChooseContextFile: contextPanelState.handleChooseContextFile,
    onDropContextFile: contextPanelState.handleDropContextFile,
    onOpenTextContextDialog: contextPanelState.openTextContextDialog,
    onOpenLinkContextDialog: contextPanelState.openLinkContextDialog,
    onContextDraftTextChange: contextPanelState.handleContextDraftTextChange,
    onContextDraftLinkChange: contextPanelState.handleContextDraftLinkChange,
    onContextDropActiveChange: contextPanelState.handleContextDropActiveChange,
    onSubmitTextContext: contextPanelState.handleSubmitTextContext,
    onSubmitLinkContext: contextPanelState.handleSubmitLinkContext,
  };
}
