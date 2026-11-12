import { useSyncExternalStore } from "react";

export type ConversationHistoryRequest =
  | { type: "navigate"; sessionId: string }
  | { type: "home" };

const MAX_ENTRIES = 50;
let entries: string[] = [];
let index = -1;
let snapshot = { canBack: false, canForward: false };
let suppressedRecording: string | null = null;
let suppressRecordingUntil = 0;
const listeners = new Set<() => void>();
const requestListeners = new Set<(request: ConversationHistoryRequest) => void>();

function publish() {
  snapshot = {
    canBack: index > 0,
    canForward: index >= 0 && index < entries.length - 1,
  };
  for (const listener of listeners) listener();
}

export function subscribeConversationHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConversationHistorySnapshot() {
  return snapshot;
}

export function useConversationHistory() {
  return useSyncExternalStore(
    subscribeConversationHistory,
    getConversationHistorySnapshot,
    getConversationHistorySnapshot,
  );
}

export function recordConversationNavigation(sessionId: string) {
  const normalized = sessionId.trim();
  if (!normalized) return;
  if (Date.now() < suppressRecordingUntil) return;
  if (suppressedRecording) {
    const suppressed = suppressedRecording;
    suppressedRecording = null;
    if (normalized === suppressed) return;
  }
  if (entries[index] === normalized) return;
  entries = [...entries.slice(0, index + 1), normalized].slice(-MAX_ENTRIES);
  index = entries.length - 1;
  publish();
}

export function requestConversationHistoryBack(): boolean {
  if (index <= 0) return false;
  suppressedRecording = entries[index] ?? null;
  suppressRecordingUntil = Date.now() + 800;
  index -= 1;
  publish();
  request({ type: "navigate", sessionId: entries[index] });
  return true;
}

export function requestConversationHistoryForward(): boolean {
  if (index < 0 || index >= entries.length - 1) return false;
  suppressedRecording = entries[index] ?? null;
  suppressRecordingUntil = Date.now() + 800;
  index += 1;
  publish();
  request({ type: "navigate", sessionId: entries[index] });
  return true;
}

function request(request: ConversationHistoryRequest) {
  for (const listener of requestListeners) listener(request);
}

export function subscribeConversationHistoryRequests(
  listener: (request: ConversationHistoryRequest) => void,
): () => void {
  requestListeners.add(listener);
  return () => requestListeners.delete(listener);
}

export function resetConversationHistoryForTest() {
  entries = [];
  index = -1;
  suppressedRecording = null;
  suppressRecordingUntil = 0;
  snapshot = { canBack: false, canForward: false };
  for (const listener of listeners) listener();
}
