import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  ensureConversationTab,
  getConversationTabsSnapshot,
  resetConversationTabsForTest,
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

  it("shows a synthetic active New chat tab on home", () => {
    ensureConversationTab("session-a", "Alpha");
    act(() =>
      root.render(
        <ConversationTabBar currentSessionId={null} homeActive />,
      ),
    );
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs[0]?.textContent).toContain("New chat");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");
  });

  it("closes a tab from its close button", () => {
    ensureConversationTab("session-a", "Alpha");
    ensureConversationTab("session-b", "Beta");
    act(() =>
      root.render(<ConversationTabBar currentSessionId="session-b" />),
    );

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="conversation-tab-close-session-a"]',
        )
        ?.click();
    });
    expect(getConversationTabsSnapshot().tabs.map((tab) => tab.sessionId)).toEqual(
      ["session-b"],
    );
  });
});
