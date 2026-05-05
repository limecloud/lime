export interface HistoricalConversationMessageLike {
  id: string;
  role: string;
  content: string;
  isThinking?: boolean;
  thinkingContent?: string;
  toolCalls?: readonly unknown[];
  actionRequests?: readonly unknown[];
  contentParts?: readonly unknown[];
}

export interface HistoricalMessageHydrationState {
  isRestoredHistoryWindow: boolean;
  focusedTimelineItemId?: string | null;
  isSending?: boolean;
  activeCurrentTurnId?: string | null;
}

const STRUCTURED_HISTORY_CONTENT_RE = /<a2ui|```\s*a2ui|<write_file|<document/i;

export function hasStructuredHistoricalContentHint(content: string): boolean {
  return STRUCTURED_HISTORY_CONTENT_RE.test(content);
}

export function isHistoricalAssistantMessageHydrationCandidate<
  TMessage extends HistoricalConversationMessageLike,
>(
  message: TMessage,
  state: HistoricalMessageHydrationState,
): boolean {
  return (
    state.isRestoredHistoryWindow &&
    !state.focusedTimelineItemId &&
    !state.isSending &&
    !state.activeCurrentTurnId &&
    message.role === "assistant" &&
    !message.isThinking &&
    !message.thinkingContent &&
    (message.toolCalls?.length ?? 0) === 0 &&
    (message.actionRequests?.length ?? 0) === 0
  );
}

export function buildHistoricalMarkdownHydrationTargets<
  TMessage extends HistoricalConversationMessageLike,
>(params: {
  messages: readonly TMessage[];
  state: HistoricalMessageHydrationState;
}): string[] {
  if (!params.state.isRestoredHistoryWindow) {
    return [];
  }

  const targetIds: string[] = [];
  for (const message of params.messages) {
    const content = message.content.trim();
    if (
      content &&
      !hasStructuredHistoricalContentHint(content) &&
      isHistoricalAssistantMessageHydrationCandidate(message, params.state)
    ) {
      targetIds.push(message.id);
    }
  }
  return targetIds;
}

export function buildHistoricalMarkdownHydrationIndexByMessageId(
  targetIds: readonly string[],
): Map<string, number> {
  const indexed = new Map<string, number>();
  targetIds.forEach((messageId, index) => {
    indexed.set(messageId, index);
  });
  return indexed;
}

export function isHistoricalMarkdownHydrated(params: {
  messageId: string;
  hydrationIndexByMessageId: ReadonlyMap<string, number>;
  hydratedHistoricalMarkdownCount: number;
}): boolean {
  const hydrationIndex = params.hydrationIndexByMessageId.get(
    params.messageId,
  );
  return (
    hydrationIndex === undefined ||
    hydrationIndex < params.hydratedHistoricalMarkdownCount
  );
}

export function shouldDeferHistoricalAssistantMessageDetails<
  TMessage extends HistoricalConversationMessageLike,
>(params: {
  message: TMessage;
  state: HistoricalMessageHydrationState;
  isHistoricalTimelineReady: boolean;
  hydrationIndexByMessageId: ReadonlyMap<string, number>;
  hydratedHistoricalMarkdownCount: number;
}): boolean {
  return (
    isHistoricalAssistantMessageHydrationCandidate(
      params.message,
      params.state,
    ) &&
    (!params.isHistoricalTimelineReady ||
      !isHistoricalMarkdownHydrated({
        messageId: params.message.id,
        hydrationIndexByMessageId: params.hydrationIndexByMessageId,
        hydratedHistoricalMarkdownCount:
          params.hydratedHistoricalMarkdownCount,
      }))
  );
}

export function countDeferredHistoricalContentParts<
  TMessage extends HistoricalConversationMessageLike,
>(params: {
  messages: readonly TMessage[];
  state: HistoricalMessageHydrationState;
  isHistoricalTimelineReady: boolean;
  hydrationIndexByMessageId: ReadonlyMap<string, number>;
  hydratedHistoricalMarkdownCount: number;
}): number {
  if (!params.state.isRestoredHistoryWindow) {
    return 0;
  }

  let count = 0;
  for (const message of params.messages) {
    if (
      (message.contentParts?.length ?? 0) > 0 &&
      shouldDeferHistoricalAssistantMessageDetails({
        message,
        state: params.state,
        isHistoricalTimelineReady: params.isHistoricalTimelineReady,
        hydrationIndexByMessageId: params.hydrationIndexByMessageId,
        hydratedHistoricalMarkdownCount:
          params.hydratedHistoricalMarkdownCount,
      })
    ) {
      count += 1;
    }
  }
  return count;
}

export function countDeferredHistoricalMarkdown(params: {
  isRestoredHistoryWindow: boolean;
  targetCount: number;
  hydratedHistoricalMarkdownCount: number;
}): number {
  if (!params.isRestoredHistoryWindow) {
    return 0;
  }
  return Math.max(
    0,
    params.targetCount - params.hydratedHistoricalMarkdownCount,
  );
}
