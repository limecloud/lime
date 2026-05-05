export interface SessionHistoryWindowState {
  loadedMessages: number;
  totalMessages: number;
  historyBeforeMessageId?: number | null;
  historyStartIndex?: number | null;
  isLoadingFull: boolean;
  error: string | null;
}

export interface SessionHistoryDetailLike {
  history_cursor?: {
    oldest_message_id?: number | null;
    start_index?: number | null;
  } | null;
  history_limit?: number | null;
  history_offset?: number | null;
  history_truncated?: boolean | null;
  messages: readonly unknown[];
  messages_count?: number | null;
}

export interface SessionHistoryPageRequestPlan {
  historyBeforeMessageId: number | null;
  loadedMessagesCount: number;
  loadingWindow: SessionHistoryWindowState;
  nextHistoryLimit: number;
  nextHistoryOffset: number;
  requestOptions: {
    historyBeforeMessageId?: number;
    historyLimit: number;
    historyOffset: number;
  };
  totalMessagesCount: number;
}

export interface SessionHistoryPageResultPlan {
  detailLoadedMessages: number;
  nextHistoryBeforeMessageId: number | null;
  nextHistoryStartIndex: number | null;
  nextHistoryWindow: SessionHistoryWindowState | null;
  nextLoadedMessages: number;
  resolvedTotalMessages: number;
}

export function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : null;
}

export function normalizeNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

export function resolveDetailHistoryLoadedMessages(
  detail: SessionHistoryDetailLike,
): number {
  const totalMessages =
    normalizeNonNegativeInteger(detail.messages_count) ??
    detail.messages.length;
  const cursorStartIndex = normalizeNonNegativeInteger(
    detail.history_cursor?.start_index,
  );
  if (cursorStartIndex !== null) {
    return Math.min(
      totalMessages,
      Math.max(detail.messages.length, totalMessages - cursorStartIndex),
    );
  }
  const historyLimit =
    normalizeNonNegativeInteger(detail.history_limit) ?? null;
  const historyOffset = normalizeNonNegativeInteger(detail.history_offset) ?? 0;

  if (historyLimit === null) {
    return detail.messages.length;
  }

  return Math.min(totalMessages, historyOffset + historyLimit);
}

export function resolveSessionHistoryWindowFromDetail(
  detail: SessionHistoryDetailLike,
): SessionHistoryWindowState | null {
  if (detail.history_truncated !== true) {
    return null;
  }

  const loadedMessages = resolveDetailHistoryLoadedMessages(detail);
  const totalMessages = Math.max(
    loadedMessages,
    normalizeNonNegativeInteger(detail.messages_count) ?? loadedMessages,
  );

  if (totalMessages <= loadedMessages) {
    return null;
  }

  return {
    loadedMessages,
    totalMessages,
    historyBeforeMessageId: normalizePositiveInteger(
      detail.history_cursor?.oldest_message_id,
    ),
    historyStartIndex: normalizeNonNegativeInteger(
      detail.history_cursor?.start_index,
    ),
    isLoadingFull: false,
    error: null,
  };
}

export function buildSessionHistoryPageRequestPlan(params: {
  currentHistoryWindow?: SessionHistoryWindowState | null;
  currentMessagesCount: number;
  pageSize: number;
}): SessionHistoryPageRequestPlan | null {
  const currentHistoryWindow = params.currentHistoryWindow;
  if (currentHistoryWindow?.isLoadingFull) {
    return null;
  }

  const loadedMessagesCount =
    currentHistoryWindow?.loadedMessages ?? params.currentMessagesCount;
  const totalMessagesCount =
    currentHistoryWindow?.totalMessages ?? loadedMessagesCount;
  const nextHistoryOffset = loadedMessagesCount;
  const historyBeforeMessageId =
    normalizePositiveInteger(currentHistoryWindow?.historyBeforeMessageId) ??
    null;
  const nextHistoryLimit =
    totalMessagesCount > loadedMessagesCount
      ? Math.min(params.pageSize, totalMessagesCount - loadedMessagesCount)
      : params.pageSize;

  if (nextHistoryLimit <= 0) {
    return null;
  }

  return {
    historyBeforeMessageId,
    loadedMessagesCount,
    loadingWindow: currentHistoryWindow
      ? { ...currentHistoryWindow, isLoadingFull: true, error: null }
      : {
          loadedMessages: loadedMessagesCount,
          totalMessages: totalMessagesCount,
          historyBeforeMessageId,
          historyStartIndex: null,
          isLoadingFull: true,
          error: null,
        },
    nextHistoryLimit,
    nextHistoryOffset,
    requestOptions: {
      historyLimit: nextHistoryLimit,
      historyOffset: nextHistoryOffset,
      ...(historyBeforeMessageId !== null ? { historyBeforeMessageId } : {}),
    },
    totalMessagesCount,
  };
}

export function buildSessionHistoryPageResultPlan(params: {
  detail: SessionHistoryDetailLike;
  historyBeforeMessageId: number | null;
  nextHistoryLimit: number;
  nextHistoryOffset: number;
  totalMessagesCount: number;
}): SessionHistoryPageResultPlan {
  const detailLoadedMessages = resolveDetailHistoryLoadedMessages(
    params.detail,
  );
  const detailTotalMessages =
    normalizeNonNegativeInteger(params.detail.messages_count) ??
    params.totalMessagesCount;
  const nextLoadedMessages = Math.min(
    detailTotalMessages,
    Math.max(
      detailLoadedMessages,
      params.nextHistoryOffset + params.nextHistoryLimit,
    ),
  );
  const resolvedTotalMessages = Math.max(
    nextLoadedMessages,
    detailTotalMessages,
  );
  const nextHistoryBeforeMessageId = normalizePositiveInteger(
    params.detail.history_cursor?.oldest_message_id,
  );
  const nextHistoryStartIndex = normalizeNonNegativeInteger(
    params.detail.history_cursor?.start_index,
  );

  return {
    detailLoadedMessages,
    nextHistoryBeforeMessageId,
    nextHistoryStartIndex,
    nextLoadedMessages,
    resolvedTotalMessages,
    nextHistoryWindow:
      resolvedTotalMessages > nextLoadedMessages
        ? {
            loadedMessages: nextLoadedMessages,
            totalMessages: resolvedTotalMessages,
            historyBeforeMessageId:
              nextHistoryBeforeMessageId ?? params.historyBeforeMessageId,
            historyStartIndex: nextHistoryStartIndex,
            isLoadingFull: false,
            error: null,
          }
        : null,
  };
}
