import {
  loadPersisted,
  savePersisted,
} from "@/components/agent/chat/hooks/agentChatStorage";

interface BrowserPresentationOwner {
  sessionId: string | null;
  threadId: string | null;
}

// Renderer presentation only. Native tabs and their lifetime remain owned by BrowserTabHost.
function key(owner: BrowserPresentationOwner): string | null {
  return owner.sessionId && owner.threadId
    ? `browser-presentation:${JSON.stringify([owner.sessionId, owner.threadId])}`
    : null;
}

export function readBrowserPresentation(
  owner: BrowserPresentationOwner,
): string | null {
  const scope = key(owner);
  if (!scope) return null;
  const value = loadPersisted<unknown>(scope, null);
  const tabId =
    typeof value === "object" && value !== null && "tabId" in value
      ? value.tabId
      : value;
  return typeof tabId === "string" && tabId.trim() ? tabId : null;
}

export function rememberBrowserPresentation(
  owner: BrowserPresentationOwner,
  tabId: string | null,
  url?: string,
): void {
  const scope = key(owner);
  if (!scope) return;
  savePersisted(scope, tabId && url ? { tabId, url } : { tabId });
}

export function hasBrowserPresentation(
  owner: BrowserPresentationOwner,
): boolean {
  const scope = key(owner);
  if (!scope) return false;
  const value = loadPersisted<unknown>(scope, undefined);
  // Older teardown paths wrote bare null. Only an explicit presentation record
  // can suppress recovery from the canonical delivered browser result.
  return value !== undefined && value !== null;
}

export function readBrowserPresentationUrl(
  owner: BrowserPresentationOwner,
): string | null {
  const scope = key(owner);
  const value = scope ? loadPersisted<unknown>(scope, null) : null;
  return typeof value === "object" && value !== null && "url" in value
    ? browserResumeUrl(value.url)
    : null;
}

export function browserResumeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
