import type { BrowserTabEventIdentity, BrowserTabState } from "@/lib/api/browserTab";

export function matchesBrowserTabEvent(
  state: BrowserTabState | null,
  event: BrowserTabEventIdentity & { viewId: string },
): boolean {
  return Boolean(state && state.tabId === event.tabId && state.viewId === event.viewId &&
    state.browserSessionId === event.browserSessionId && state.threadId === event.threadId &&
    state.webContentsId === event.webContentsId && state.ownerWebContentsId === event.ownerWebContentsId &&
    state.windowId === event.windowId);
}
