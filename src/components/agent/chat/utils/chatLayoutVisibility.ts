interface ResolveChatLayoutVisibilityParams {
  agentEntry: string;
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
  hasDisplayMessages,
  hasPendingA2UIForm,
  isThemeWorkbench,
  hasUnconsumedInitialDispatch,
  isPreparingSend,
  isSending,
  queuedTurnCount,
}: ResolveChatLayoutVisibilityParams): boolean {
  return (
    agentEntry === "claw" ||
    hasDisplayMessages ||
    hasPendingA2UIForm ||
    isThemeWorkbench ||
    hasUnconsumedInitialDispatch ||
    isPreparingSend ||
    isSending ||
    queuedTurnCount > 0
  );
}
