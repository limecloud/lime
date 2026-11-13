import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  ensureConversationTab,
  getConversationTabsSnapshot,
  resetConversationTabsForTest,
  setConversationTabPinned,
} from "@/lib/conversationTabs";
import { ConversationTabBar } from "./ConversationTabBar";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  resetConversationTabsForTest();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("ConversationTabBar", () => {
  it("renders open tabs and switches to another tab", () => {
    ensureConversationTab("session-a", "Alpha");
    ensureConversationTab("session-b", "Beta");
    act(() =>
      root.render(<ConversationTabBar currentSessionId="session-b" />),
    );
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Beta");

    act(() => {
      container
        .querySelector<HTMLElement>(
          '[data-session-id="session-a"]',
        )
        ?.click();
    });
    expect(getConversationTabsSnapshot().activeSessionId).toBe("session-a");
  });

  it("asks before closing a pinned tab", async () => {
    ensureConversationTab("session-a", "Alpha");
    setConversationTabPinned("session-a", true);
    act(() =>
      root.render(<ConversationTabBar currentSessionId="session-a" />),
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="conversation-tab-close-session-a"]',
        )
        ?.click();
      await Promise.resolve();
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="conversation-tab-close-pinned-confirm"]',
        )
        ?.click();
      await Promise.resolve();
    });
    expect(getConversationTabsSnapshot().tabs).toHaveLength(0);
  });

  it("closes a tab from its close button", async () => {
    ensureConversationTab("session-a", "Alpha");
    ensureConversationTab("session-b", "Beta");
    act(() =>
      root.render(<ConversationTabBar currentSessionId="session-b" />),
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="conversation-tab-close-session-a"]',
        )
        ?.click();
      await Promise.resolve();
    });
    expect(getConversationTabsSnapshot().tabs.map((tab) => tab.sessionId)).toEqual(
      ["session-b"],
    );
  });
});
