import { useSyncExternalStore } from "react";

export interface ImportHistoryEntry {
  id: string;
  kind: "skills" | "settings" | "projects" | "chats";
  summary: string;
  createdAt: number;
}
const STORAGE_KEY = "lime.import.history.v1";
const MAX_ENTRIES = 20;
let current = read();
const listeners = new Set<() => void>();

function read(): ImportHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is ImportHistoryEntry =>
            Boolean(entry) &&
            typeof entry.id === "string" &&
            typeof entry.summary === "string" &&
            typeof entry.createdAt === "number",
        )
      : [];
  } catch {
    return [];
  }
}
function publish() {
  for (const listener of listeners) listener();
}
export function getImportHistory(): readonly ImportHistoryEntry[] {
  return current;
}
export function recordImport(
  entry: Omit<ImportHistoryEntry, "id" | "createdAt">,
) {
  current = [
    {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    },
    ...current,
  ].slice(0, MAX_ENTRIES);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // ignore
    }
  }
  publish();
}
export function subscribeImportHistory(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useImportHistory() {
  return useSyncExternalStore(
    subscribeImportHistory,
    getImportHistory,
    getImportHistory,
  );
}
export function clearImportHistory() {
  current = [];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  publish();
}

export function resetImportHistoryForTest() {
  current = [];
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
  publish();
}
