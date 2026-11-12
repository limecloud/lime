import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateConversationTab,
  closeConversationTab,
  ensureConversationTab,
  getConversationTabsSnapshot,
  moveConversationTab,
  resetConversationTabsForTest,
  subscribeConversationTabRequests,
} from "./conversationTabs";

beforeEach(() => {
  resetConversationTabsForTest();
});

describe("conversationTabs", () => {
  it("adds and activates a conversation tab", () => {
    ensureConversationTab("session-a", "A");
    ensureConversationTab("session-b", "B");
    expect(getConversationTabsSnapshot().tabs).toEqual([
      { sessionId: "session-b", title: "B" },
      { sessionId: "session-a", title: "A" },
    ]);
    expect(getConversationTabsSnapshot().activeSessionId).toBe("session-b");
  });

  it("navigates to the neighbour when the active tab closes", () => {
    const requests = vi.fn();
    const stop = subscribeConversationTabRequests(requests);
    ensureConversationTab("session-a", "A");
    ensureConversationTab("session-b", "B");

    closeConversationTab("session-b");

    expect(getConversationTabsSnapshot().tabs).toEqual([
      { sessionId: "session-a", title: "A" },
    ]);
    expect(requests).toHaveBeenCalledWith({
      type: "navigate",
      sessionId: "session-a",
    });
    stop();
  });

  it("does not navigate when an inactive tab closes", () => {
    const requests = vi.fn();
    const stop = subscribeConversationTabRequests(requests);
    ensureConversationTab("session-a", "A");
    ensureConversationTab("session-b", "B");

    closeConversationTab("session-a");

    expect(requests).not.toHaveBeenCalled();
    stop();
  });

  it("reorders tabs after a drag", () => {
    ensureConversationTab("session-a", "A");
    ensureConversationTab("session-b", "B");
    ensureConversationTab("session-c", "C");

    moveConversationTab("session-a", "session-c");

    expect(getConversationTabsSnapshot().tabs.map((tab) => tab.sessionId)).toEqual(
      ["session-a", "session-c", "session-b"],
    );
  });

  it("navigates on tab activation", () => {
    const requests = vi.fn();
    const stop = subscribeConversationTabRequests(requests);
    ensureConversationTab("session-a", "A");
    ensureConversationTab("session-b", "B");

    activateConversationTab("session-a");

    expect(requests).toHaveBeenCalledWith({
      type: "navigate",
      sessionId: "session-a",
    });
    stop();
  });
});
