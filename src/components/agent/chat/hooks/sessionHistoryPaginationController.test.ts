import { describe, expect, it } from "vitest";
import {
  buildSessionHistoryPageRequestPlan,
  buildSessionHistoryPageResultPlan,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  resolveDetailHistoryLoadedMessages,
  resolveSessionHistoryWindowFromDetail,
} from "./sessionHistoryPaginationController";

function messages(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `m-${index}` }));
}

describe("sessionHistoryPaginationController", () => {
  it("应归一化整数边界", () => {
    expect(normalizePositiveInteger(1.8)).toBe(1);
    expect(normalizePositiveInteger(0)).toBeNull();
    expect(normalizeNonNegativeInteger(0)).toBe(0);
    expect(normalizeNonNegativeInteger(-1)).toBeNull();
  });

  it("应从 detail cursor / limit offset 推导已加载消息数", () => {
    expect(
      resolveDetailHistoryLoadedMessages({
        messages: messages(40),
        messages_count: 320,
        history_cursor: { start_index: 280 },
      }),
    ).toBe(40);

    expect(
      resolveDetailHistoryLoadedMessages({
        messages: messages(50),
        messages_count: 320,
        history_limit: 50,
        history_offset: 40,
      }),
    ).toBe(90);
  });

  it("未截断或已全量加载时不应保留 history window", () => {
    expect(
      resolveSessionHistoryWindowFromDetail({
        messages: messages(40),
        history_truncated: false,
      }),
    ).toBeNull();

    expect(
      resolveSessionHistoryWindowFromDetail({
        messages: messages(40),
        messages_count: 40,
        history_truncated: true,
      }),
    ).toBeNull();
  });

  it("应构造首个完整历史分页请求计划", () => {
    expect(
      buildSessionHistoryPageRequestPlan({
        currentHistoryWindow: {
          loadedMessages: 40,
          totalMessages: 320,
          historyBeforeMessageId: 281,
          historyStartIndex: 280,
          isLoadingFull: false,
          error: "old",
        },
        currentMessagesCount: 40,
        pageSize: 50,
      }),
    ).toEqual({
      historyBeforeMessageId: 281,
      loadedMessagesCount: 40,
      loadingWindow: {
        loadedMessages: 40,
        totalMessages: 320,
        historyBeforeMessageId: 281,
        historyStartIndex: 280,
        isLoadingFull: true,
        error: null,
      },
      nextHistoryLimit: 50,
      nextHistoryOffset: 40,
      requestOptions: {
        historyLimit: 50,
        historyOffset: 40,
        historyBeforeMessageId: 281,
      },
      totalMessagesCount: 320,
    });
  });

  it("已在加载时不应重复构造分页请求", () => {
    expect(
      buildSessionHistoryPageRequestPlan({
        currentHistoryWindow: {
          loadedMessages: 40,
          totalMessages: 320,
          isLoadingFull: true,
          error: null,
        },
        currentMessagesCount: 40,
        pageSize: 50,
      }),
    ).toBeNull();
  });

  it("应根据分页 detail 构造下一轮 history window", () => {
    expect(
      buildSessionHistoryPageResultPlan({
        detail: {
          messages: messages(50),
          messages_count: 320,
          history_limit: 50,
          history_offset: 40,
          history_cursor: {
            oldest_message_id: 231,
            start_index: 230,
          },
        },
        historyBeforeMessageId: 281,
        nextHistoryLimit: 50,
        nextHistoryOffset: 40,
        totalMessagesCount: 320,
      }),
    ).toMatchObject({
      detailLoadedMessages: 90,
      nextHistoryBeforeMessageId: 231,
      nextHistoryStartIndex: 230,
      nextLoadedMessages: 90,
      resolvedTotalMessages: 320,
      nextHistoryWindow: {
        loadedMessages: 90,
        totalMessages: 320,
        historyBeforeMessageId: 231,
        historyStartIndex: 230,
        isLoadingFull: false,
        error: null,
      },
    });
  });
});
