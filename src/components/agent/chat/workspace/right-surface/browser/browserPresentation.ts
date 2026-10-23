interface BrowserPresentationOwner {
  sessionId: string | null;
  threadId: string | null;
}

// Renderer presentation only. Native tabs and their lifetime remain owned by BrowserTabHost.
const selectedTabs = new Map<string, string>();

function key(owner: BrowserPresentationOwner): string | null {
  return owner.sessionId && owner.threadId
    ? JSON.stringify([owner.sessionId, owner.threadId])
    : null;
}

export function readBrowserPresentation(
  owner: BrowserPresentationOwner,
): string | null {
  const scope = key(owner);
  return scope ? (selectedTabs.get(scope) ?? null) : null;
}

export function rememberBrowserPresentation(
  owner: BrowserPresentationOwner,
  tabId: string | null,
): void {
  const scope = key(owner);
  if (!scope) return;
  if (tabId) selectedTabs.set(scope, tabId);
  else selectedTabs.delete(scope);
}
