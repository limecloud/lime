export interface ConversationThreadTurnLike {
  id: string;
}

export interface ConversationThreadItemLike {
  turn_id: string;
}

export interface ConversationThreadTimelineWindowProjection<TTurn, TItem> {
  renderedTurns: TTurn[];
  renderedTurnIdSet: Set<string> | null;
  renderedThreadItems: TItem[];
}

export function resolveConversationRenderedTurns<
  TTurn extends ConversationThreadTurnLike,
>(params: {
  turns: readonly TTurn[];
  currentTurnId?: string | null;
  hiddenHistoryCount: number;
  isRestoredHistoryWindow: boolean;
  renderedAssistantMessageCount: number;
  renderedMessageCount: number;
  progressiveInitialRenderCount: number;
}): TTurn[] {
  const shouldWindowTurns =
    params.hiddenHistoryCount > 0 || params.isRestoredHistoryWindow;
  if (!shouldWindowTurns) {
    return [...params.turns];
  }

  const restoredTurnWindowSize = Math.max(
    1,
    params.renderedAssistantMessageCount + 1,
  );
  const turnWindowSize = params.isRestoredHistoryWindow
    ? restoredTurnWindowSize
    : Math.max(
        params.renderedMessageCount,
        params.progressiveInitialRenderCount,
      );
  const tailTurns =
    turnWindowSize > 0
      ? params.turns.slice(-Math.min(params.turns.length, turnWindowSize))
      : [];
  if (
    !params.currentTurnId ||
    tailTurns.some((turn) => turn.id === params.currentTurnId)
  ) {
    return tailTurns;
  }

  const selectedTurnIds = new Set(tailTurns.map((turn) => turn.id));
  selectedTurnIds.add(params.currentTurnId);
  return params.turns.filter((turn) => selectedTurnIds.has(turn.id));
}

export function resolveConversationRenderedTurnIdSet<
  TTurn extends ConversationThreadTurnLike,
>(params: {
  renderedTurns: readonly TTurn[];
  hiddenHistoryCount: number;
  isRestoredHistoryWindow: boolean;
}): Set<string> | null {
  if (params.hiddenHistoryCount <= 0 && !params.isRestoredHistoryWindow) {
    return null;
  }
  return new Set(params.renderedTurns.map((turn) => turn.id));
}

export function filterConversationThreadItemsForRenderedTurns<
  TItem extends ConversationThreadItemLike,
>(params: {
  threadItems: readonly TItem[];
  renderedTurnIdSet: Set<string> | null;
  shouldDeferThreadItemsScan: boolean;
}): TItem[] {
  if (params.shouldDeferThreadItemsScan) {
    return [];
  }

  if (!params.renderedTurnIdSet) {
    return [...params.threadItems];
  }
  if (params.renderedTurnIdSet.size === 0) {
    return [];
  }

  const scopedItems: TItem[] = [];
  for (const item of params.threadItems) {
    if (params.renderedTurnIdSet.has(item.turn_id)) {
      scopedItems.push(item);
    }
  }
  return scopedItems;
}

export function buildConversationThreadTimelineWindowProjection<
  TTurn extends ConversationThreadTurnLike,
  TItem extends ConversationThreadItemLike,
>(params: {
  turns: readonly TTurn[];
  threadItems: readonly TItem[];
  currentTurnId?: string | null;
  hiddenHistoryCount: number;
  isRestoredHistoryWindow: boolean;
  renderedAssistantMessageCount: number;
  renderedMessageCount: number;
  progressiveInitialRenderCount: number;
  shouldDeferThreadItemsScan: boolean;
}): ConversationThreadTimelineWindowProjection<TTurn, TItem> {
  const renderedTurns = resolveConversationRenderedTurns({
    turns: params.turns,
    currentTurnId: params.currentTurnId,
    hiddenHistoryCount: params.hiddenHistoryCount,
    isRestoredHistoryWindow: params.isRestoredHistoryWindow,
    renderedAssistantMessageCount: params.renderedAssistantMessageCount,
    renderedMessageCount: params.renderedMessageCount,
    progressiveInitialRenderCount: params.progressiveInitialRenderCount,
  });
  const renderedTurnIdSet = resolveConversationRenderedTurnIdSet({
    renderedTurns,
    hiddenHistoryCount: params.hiddenHistoryCount,
    isRestoredHistoryWindow: params.isRestoredHistoryWindow,
  });
  const renderedThreadItems = filterConversationThreadItemsForRenderedTurns({
    threadItems: params.threadItems,
    renderedTurnIdSet,
    shouldDeferThreadItemsScan: params.shouldDeferThreadItemsScan,
  });

  return {
    renderedTurns,
    renderedTurnIdSet,
    renderedThreadItems,
  };
}
