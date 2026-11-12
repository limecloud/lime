import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConversationHistorySnapshot,
  recordConversationNavigation,
  requestConversationHistoryBack,
  requestConversationHistoryForward,
  resetConversationHistoryForTest,
  subscribeConversationHistoryRequests,
} from "./conversationHistory";

beforeEach(() => {
  resetConversationHistoryForTest();
});

describe("conversationHistory", () => {
  it("walks back and forward through visited conversations", () => {
    const requests = vi.fn();
    const stop = subscribeConversationHistoryRequests(requests);
    recordConversationNavigation("a");
    recordConversationNavigation("b");
    recordConversationNavigation("c");

    expect(getConversationHistorySnapshot()).toEqual({
      canBack: true,
      canForward: false,
    });
    expect(requestConversationHistoryBack()).toBe(true);
    expect(requests).toHaveBeenLastCalledWith({
      type: "navigate",
      sessionId: "b",
    });
    expect(requestConversationHistoryBack()).toBe(true);
    expect(requests).toHaveBeenLastCalledWith({
      type: "navigate",
      sessionId: "a",
    });
    expect(requestConversationHistoryBack()).toBe(false);

    expect(requestConversationHistoryForward()).toBe(true);
    expect(requests).toHaveBeenLastCalledWith({
      type: "navigate",
      sessionId: "b",
    });
    stop();
  });

  it("ignores the stale session recorded right after going back", () => {
    recordConversationNavigation("a");
    recordConversationNavigation("b");
    requestConversationHistoryBack();

    recordConversationNavigation("b");

    expect(getConversationHistorySnapshot()).toEqual({
      canBack: false,
      canForward: true,
    });
  });

  it("drops forward entries after a new navigation", () => {
    vi.useFakeTimers();
    try {
      recordConversationNavigation("a");
      recordConversationNavigation("b");
      requestConversationHistoryBack();
      vi.advanceTimersByTime(1_000);
      recordConversationNavigation("c");

      expect(getConversationHistorySnapshot()).toEqual({
        canBack: true,
        canForward: false,
      });
      expect(requestConversationHistoryForward()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
