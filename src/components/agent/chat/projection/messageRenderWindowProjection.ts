export interface ConversationVisibleMessageLike {
  role: string;
  content: string;
  images?: readonly unknown[];
}

export interface ConversationMessageRenderWindowSettings {
  progressiveRenderThreshold: number;
  initialRenderCount: number;
  renderBatchSize: number;
  minimumDelayMs: number;
}

export interface ConversationMessageRenderWindowSettingsSet {
  regular: ConversationMessageRenderWindowSettings;
  restored: ConversationMessageRenderWindowSettings;
}

export interface ConversationMessageRenderWindowProjection<T> {
  visibleMessages: T[];
  renderedMessages: T[];
  renderedMessageCount: number;
  hiddenHistoryCount: number;
  shouldUseProgressiveRender: boolean;
  shouldAutoHydrateHiddenHistory: boolean;
  progressiveRenderThreshold: number;
  progressiveInitialRenderCount: number;
  progressiveRenderBatchSize: number;
  progressiveRenderMinimumDelayMs: number;
}

export function filterVisibleConversationMessages<
  T extends ConversationVisibleMessageLike,
>(messages: readonly T[]): T[] {
  return messages.filter((message) => {
    if (message.role !== "user") {
      return true;
    }
    if (message.content.trim().length > 0) {
      return true;
    }
    return Array.isArray(message.images) && message.images.length > 0;
  });
}

export function resolveConversationMessageRenderWindowSettings(
  settingsSet: ConversationMessageRenderWindowSettingsSet,
  isRestoredHistoryWindow: boolean,
): ConversationMessageRenderWindowSettings {
  return isRestoredHistoryWindow ? settingsSet.restored : settingsSet.regular;
}

export function shouldUseConversationProgressiveRender(params: {
  isSending: boolean;
  visibleMessageCount: number;
  settings: ConversationMessageRenderWindowSettings;
}): boolean {
  return (
    !params.isSending &&
    params.visibleMessageCount > params.settings.progressiveRenderThreshold
  );
}

export function resolveInitialConversationRenderedMessageCount(params: {
  isSending: boolean;
  visibleMessageCount: number;
  settings: ConversationMessageRenderWindowSettings;
}): number {
  return shouldUseConversationProgressiveRender(params)
    ? Math.min(params.visibleMessageCount, params.settings.initialRenderCount)
    : params.visibleMessageCount;
}

export function buildConversationMessageRenderWindowProjection<
  T extends ConversationVisibleMessageLike,
>(params: {
  visibleMessages: readonly T[];
  renderedMessageCount: number;
  isSending: boolean;
  isRestoredHistoryWindow: boolean;
  settings: ConversationMessageRenderWindowSettings;
}): ConversationMessageRenderWindowProjection<T> {
  const visibleMessages = [...params.visibleMessages];
  const shouldUseProgressiveRender = shouldUseConversationProgressiveRender({
    isSending: params.isSending,
    visibleMessageCount: visibleMessages.length,
    settings: params.settings,
  });
  const renderedMessageCount = shouldUseProgressiveRender
    ? Math.min(
        visibleMessages.length,
        Math.max(0, params.renderedMessageCount),
      )
    : visibleMessages.length;
  const hiddenHistoryCount = shouldUseProgressiveRender
    ? Math.max(0, visibleMessages.length - renderedMessageCount)
    : 0;
  const renderedMessages =
    hiddenHistoryCount > 0
      ? visibleMessages.slice(-renderedMessageCount)
      : visibleMessages;

  return {
    visibleMessages,
    renderedMessages,
    renderedMessageCount,
    hiddenHistoryCount,
    shouldUseProgressiveRender,
    shouldAutoHydrateHiddenHistory:
      shouldUseProgressiveRender && !params.isRestoredHistoryWindow,
    progressiveRenderThreshold: params.settings.progressiveRenderThreshold,
    progressiveInitialRenderCount: params.settings.initialRenderCount,
    progressiveRenderBatchSize: params.settings.renderBatchSize,
    progressiveRenderMinimumDelayMs: params.settings.minimumDelayMs,
  };
}
