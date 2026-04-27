interface ResolveChatLayoutVisibilityParams {
  agentEntry: string;
  preferEmptyStateForFreshTaskCenterTab?: boolean;
  hasDisplayMessages: boolean;
  hasPendingA2UIForm: boolean;
  isThemeWorkbench: boolean;
  hasUnconsumedInitialDispatch: boolean;
  isPreparingSend: boolean;
  isSending: boolean;
  queuedTurnCount: number;
}

export function shouldShowChatLayout({
  agentEntry,
  preferEmptyStateForFreshTaskCenterTab = false,
  hasDisplayMessages,
  hasPendingA2UIForm,
  isThemeWorkbench,
  hasUnconsumedInitialDispatch,
  isPreparingSend,
  isSending,
  queuedTurnCount,
}: ResolveChatLayoutVisibilityParams): boolean {
  return (
    (agentEntry === "claw" && !preferEmptyStateForFreshTaskCenterTab) ||
    hasDisplayMessages ||
    hasPendingA2UIForm ||
    isThemeWorkbench ||
    hasUnconsumedInitialDispatch ||
    isPreparingSend ||
    isSending ||
    queuedTurnCount > 0
  );
}
