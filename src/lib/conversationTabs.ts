import { useSyncExternalStore } from "react";

export interface ConversationTab {
  sessionId: string;
  title: string;
}

export type ConversationTabRequest =
  | { type: "navigate"; sessionId: string | null }
  | { type: "create" };

const STORAGE_KEY = "lime.conversation.tabs.v1";
const MAX_TABS = 20;

let tabs: ConversationTab[] = loadTabs();
let activeSessionId: string | null = null;
let snapshot: { tabs: ConversationTab[]; activeSessionId: string | null } = {
  tabs,
  activeSessionId,
};
const listeners = new Set<() => void>();
const requestListeners = new Set<(request: ConversationTabRequest) => void>();

function loadTabs(): ConversationTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ConversationTab =>
          Boolean(item) &&
          typeof (item as ConversationTab).sessionId === "string" &&
          typeof (item as ConversationTab).title === "string",
      )
      .slice(0, MAX_TABS);
  } catch {
    return [];
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Tabs remain usable for the current session when storage is unavailable.
  }
}

function publish() {
  snapshot = { tabs, activeSessionId };
  persist();
  for (const listener of listeners) listener();
}

export function subscribeConversationTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConversationTabsSnapshot() {
  return snapshot;
}

export function useConversationTabs() {
  return useSyncExternalStore(
    subscribeConversationTabs,
    getConversationTabsSnapshot,
    getConversationTabsSnapshot,
  );
}

export function moveConversationTab(
  sessionId: string,
  targetSessionId: string,
) {
  if (sessionId === targetSessionId) return;
  const from = tabs.findIndex((tab) => tab.sessionId === sessionId);
  const to = tabs.findIndex((tab) => tab.sessionId === targetSessionId);
  if (from < 0 || to < 0) return;
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  tabs = next;
  publish();
}

export function ensureConversationTab(sessionId: string, title: string) {
  const normalizedId = sessionId.trim();
  if (!normalizedId) return;
  const normalizedTitle = title.trim() || "新聊天";
  const existing = tabs.find((tab) => tab.sessionId === normalizedId);
  let changed = false;
  if (!existing) {
    tabs = [{ sessionId: normalizedId, title: normalizedTitle }, ...tabs].slice(
      0,
      MAX_TABS,
    );
    changed = true;
  } else if (existing.title !== normalizedTitle) {
    tabs = tabs.map((tab) =>
      tab.sessionId === normalizedId
        ? { ...tab, title: normalizedTitle }
        : tab,
    );
    changed = true;
  }
  if (activeSessionId !== normalizedId) {
    activeSessionId = normalizedId;
    changed = true;
  }
  if (changed) publish();
}

export function updateConversationTabTitle(sessionId: string, title: string) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return;
  if (!tabs.some((tab) => tab.sessionId === sessionId)) return;
  tabs = tabs.map((tab) =>
    tab.sessionId === sessionId ? { ...tab, title: normalizedTitle } : tab,
  );
  publish();
}

function request(request: ConversationTabRequest) {
  for (const listener of requestListeners) listener(request);
}

export function activateConversationTab(sessionId: string) {
  if (activeSessionId === sessionId) return;
  activeSessionId = sessionId;
  publish();
  request({ type: "navigate", sessionId });
}

export function closeConversationTab(sessionId: string) {
  const index = tabs.findIndex((tab) => tab.sessionId === sessionId);
  if (index < 0) return;
  const wasActive = activeSessionId === sessionId;
  tabs = tabs.filter((tab) => tab.sessionId !== sessionId);
  if (wasActive) {
    const next = tabs[Math.min(index, tabs.length - 1)] ?? null;
    activeSessionId = next?.sessionId ?? null;
    publish();
    request({ type: "navigate", sessionId: next?.sessionId ?? null });
    return;
  }
  publish();
}

export function closeOtherConversationTabs(sessionId: string) {
  tabs = tabs.filter((tab) => tab.sessionId === sessionId);
  activeSessionId = sessionId;
  publish();
  request({ type: "navigate", sessionId });
}

export function closeAllConversationTabs() {
  tabs = [];
  activeSessionId = null;
  publish();
  request({ type: "navigate", sessionId: null });
}

export function requestNewConversationTab() {
  request({ type: "create" });
}

export function subscribeConversationTabRequests(
  listener: (request: ConversationTabRequest) => void,
): () => void {
  requestListeners.add(listener);
  return () => requestListeners.delete(listener);
}

export function resetConversationTabsForTest() {
  tabs = [];
  activeSessionId = null;
  snapshot = { tabs, activeSessionId };
  persist();
  for (const listener of listeners) listener();
}
