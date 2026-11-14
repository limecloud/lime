import { useSyncExternalStore } from "react";

const STORAGE_KEY = "lime.import.auto-sync-codex-skills.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}
function publish() {
  for (const listener of listeners) listener();
}
export function getImportAutoSyncEnabled(): boolean {
  return current;
}
export function setImportAutoSyncEnabled(enabled: boolean) {
  current = enabled;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
  }
  publish();
}
export function subscribeImportAutoSync(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useImportAutoSyncEnabled(): boolean {
  return useSyncExternalStore(
    subscribeImportAutoSync,
    getImportAutoSyncEnabled,
    getImportAutoSyncEnabled,
  );
}
export function resetImportAutoSyncForTest() {
  setImportAutoSyncEnabled(false);
}
