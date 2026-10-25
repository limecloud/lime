export interface AgentChatWorkspaceShellViewModelInput {
  agentEntry: string;
  showChatPanel: boolean;
  contentId?: string | null;
  initialSessionId?: string | null;
  displayMessageCount: number;
  threadItemCount?: number;
  isHomePendingPreviewActive: boolean;
  shouldSuppressTaskCenterDraftContent: boolean;
  hasCanvasWorkbenchContent: boolean;
  isThemeWorkbench: boolean;
  shouldUseCompactGeneralWorkbench: boolean;
  isBootstrapDispatchPending: boolean;
  isSending: boolean;
  queuedTurnCount: number;
}

export interface AgentChatWorkspaceShellViewModel {
  hasDisplayMessages: boolean;
  hasMessages: boolean;
  effectiveShowChatPanel: boolean;
  shouldRestoreImageTasksFromWorkspace: boolean;
}

export function resolveAgentChatWorkspaceShellViewModel({
  agentEntry,
  showChatPanel,
  contentId,
  initialSessionId,
  displayMessageCount,
  threadItemCount = 0,
  isHomePendingPreviewActive,
  shouldSuppressTaskCenterDraftContent,
  hasCanvasWorkbenchContent,
  isThemeWorkbench,
  shouldUseCompactGeneralWorkbench,
  isBootstrapDispatchPending,
  isSending,
  queuedTurnCount,
}: AgentChatWorkspaceShellViewModelInput): AgentChatWorkspaceShellViewModel {
  const hasDisplayMessages =
    !shouldSuppressTaskCenterDraftContent &&
    (displayMessageCount > 0 ||
      threadItemCount > 0 ||
      isHomePendingPreviewActive);
  const hasConversationActivity =
    agentEntry === "conversation" &&
    (Boolean(initialSessionId?.trim()) ||
      hasDisplayMessages ||
      isHomePendingPreviewActive ||
      (!shouldUseCompactGeneralWorkbench && isBootstrapDispatchPending) ||
      isSending ||
      queuedTurnCount > 0);
  const effectiveShowChatPanel =
    showChatPanel ||
    hasConversationActivity ||
    hasCanvasWorkbenchContent ||
    (agentEntry === "new-task" &&
      (hasDisplayMessages ||
        isThemeWorkbench ||
        (!shouldUseCompactGeneralWorkbench && isBootstrapDispatchPending) ||
        isHomePendingPreviewActive ||
        isSending ||
        queuedTurnCount > 0));
  const shouldRestoreImageTasksFromWorkspace = !(
    agentEntry === "new-task" &&
    !contentId &&
    !hasDisplayMessages &&
    !isSending &&
    queuedTurnCount === 0 &&
    !isBootstrapDispatchPending
  );

  return {
    hasDisplayMessages,
    hasMessages: hasDisplayMessages,
    effectiveShowChatPanel,
    shouldRestoreImageTasksFromWorkspace,
  };
}
