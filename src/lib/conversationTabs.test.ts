import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateConversationTab,
  closeAllConversationTabs,
  closeConversationTab,
  closeConversationTabsToTheRight,
  ensureConversationTab,
  getConversationTabsSnapshot,
  moveConversationTab,
  setConversationTabPinned,
  reopenLastClosedConversationTab,
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
      { sessionId: "session-a", title: "A" },
      { sessionId: "session-b", title: "B" },
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

  it("closes only tabs to the right of the anchor", () => {
    ensureConversationTab("session-a", "A");
    ensureConversationTab("session-b", "B");
    ensureConversationTab("session-c", "C");

    closeConversationTabsToTheRight("session-b");

    expect(getConversationTabsSnapshot().tabs.map((tab) => tab.sessionId)).toEqual(
      ["session-a", "session-b"],
    );
  });

  it("keeps pinned tabs when closing all tabs", () => {
    ensureConversationTab("session-a", "A");
    ensureConversationTab("session-b", "B");
    setConversationTabPinned("session-b", true);

    closeAllConversationTabs();

    expect(getConversationTabsSnapshot().tabs).toEqual([
      { sessionId: "session-b", title: "B", pinned: true },
    ]);
    expect(getConversationTabsSnapshot().activeSessionId).toBe("session-b");
  });

  it("reopens the most recently closed tab and activates it", () => {
    const requests = vi.fn();
    const stop = subscribeConversationTabRequests(requests);
    ensureConversationTab("session-a", "A");
    ensureConversationTab("session-b", "B");

    closeConversationTab("session-b");
    requests.mockClear();

    expect(reopenLastClosedConversationTab()).toBe("session-b");
    expect(getConversationTabsSnapshot().tabs.map((tab) => tab.sessionId)).toEqual(
      ["session-b", "session-a"],
    );
    expect(getConversationTabsSnapshot().activeSessionId).toBe("session-b");
    expect(requests).toHaveBeenCalledWith({
      type: "navigate",
      sessionId: "session-b",
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
      ["session-b", "session-c", "session-a"],
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
