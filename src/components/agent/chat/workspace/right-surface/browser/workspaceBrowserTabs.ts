import type { BrowserTabState } from "@/lib/api/browserTab";
import {
  closeSidePanelTab,
  type ThreadSidePanelTab,
  type ThreadSidePanelTabs,
} from "../threadSidePanelTabs";

/** Native state is authoritative; these fields are only the shared tab strip projection. */
export function projectWorkspaceBrowserTabs(
  current: ThreadSidePanelTabs,
  states: readonly BrowserTabState[],
): ThreadSidePanelTabs {
  const byId = new Map(states.map((state) => [state.tabId, state]));
  let next = current;
  for (const tab of current.tabs) {
    if (tab.browser && !byId.has(tab.browser.tabId))
      next = closeSidePanelTab(next, tab.tabId);
  }
  const placeholder = next.tabs.find(
    (tab) => tab.kind === "browser" && !tab.browser,
  );
  const selected = states.find((state) => state.selected) ?? states[0];
  let activeTabId = next.activeTabId;
  let changed = next !== current;
  const previousSelected = current.tabs.find((tab) => tab.browser?.selected);
  if (
    selected?.selected &&
    previousSelected &&
    previousSelected.browser?.tabId !== selected.tabId &&
    current.tabs.some(
      (tab) => tab.tabId === current.activeTabId && tab.kind === "browser",
    )
  ) {
    activeTabId = selected.tabId;
    changed = true;
  }
  const toTab = (
    state: BrowserTabState,
    previous?: ThreadSidePanelTab,
  ): ThreadSidePanelTab => {
    const browser = {
      tabId: state.tabId,
      viewId: state.viewId,
      browserSessionId: state.browserSessionId,
      threadId: state.threadId,
      webContentsId: state.webContentsId,
      ownerWebContentsId: state.ownerWebContentsId,
      windowId: state.windowId,
      url: state.url,
      faviconUrl: state.faviconUrl ?? null,
      isLoading: state.isLoading,
      audioMuted: state.audioMuted ?? false,
      selected: state.selected,
    };
    if (
      previous?.title === state.title &&
      previous.browser &&
      Object.entries(browser).every(
        ([key, value]) =>
          previous.browser?.[key as keyof typeof browser] === value,
      )
    )
      return previous;
    changed = true;
    return { tabId: state.tabId, kind: "browser", title: state.title, browser };
  };
  const tabs = next.tabs.flatMap((tab) => {
    if (tab.browser) return [toTab(byId.get(tab.browser.tabId)!, tab)];
    if (tab === placeholder && selected) {
      changed = true;
      if (activeTabId === tab.tabId) activeTabId = selected.tabId;
      return [toTab(selected)];
    }
    return [tab];
  });
  for (const state of states) {
    if (!tabs.some((tab) => tab.browser?.tabId === state.tabId))
      tabs.push(toTab(state));
  }
  return changed
    ? {
        ...next,
        tabs,
        activeTabId,
        open: next.open || Boolean(placeholder && selected),
      }
    : current;
}
