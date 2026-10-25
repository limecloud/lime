interface ResolveChatLayoutVisibilityParams {
  agentEntry: string;
  preferEmptyStateForFreshTaskCenterTab?: boolean;
  hasSession?: boolean;
  hasDisplayMessages: boolean;
  hasPendingA2UIForm: boolean;
  hasCanvasContent?: boolean;
  isThemeWorkbench: boolean;
  hasUnconsumedInitialDispatch: boolean;
  isPreparingSend: boolean;
  isSending: boolean;
  queuedTurnCount: number;
}

export function shouldShowChatLayout({
  agentEntry,
  preferEmptyStateForFreshTaskCenterTab = false,
  hasSession = false,
  hasDisplayMessages,
  hasPendingA2UIForm,
  hasCanvasContent = false,
  isThemeWorkbench,
  hasUnconsumedInitialDispatch,
  isPreparingSend,
  isSending,
  queuedTurnCount,
}: ResolveChatLayoutVisibilityParams): boolean {
  return (
    (agentEntry === "conversation" && !preferEmptyStateForFreshTaskCenterTab) ||
    hasSession ||
    hasDisplayMessages ||
    hasPendingA2UIForm ||
    hasCanvasContent ||
    isThemeWorkbench ||
    hasUnconsumedInitialDispatch ||
    isPreparingSend ||
    isSending ||
    queuedTurnCount > 0
  );
}
