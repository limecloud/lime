import { useSyncExternalStore } from "react";

const STORAGE_KEY = "lime.appearance.pointer-cursors.v1";
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

export function getPointerCursorsEnabled(): boolean {
  return current;
}

export function setPointerCursorsEnabled(enabled: boolean) {
  current = enabled;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Preference stays in memory.
    }
  }
  publish();
}

export function subscribePointerCursors(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePointerCursorsEnabled(): boolean {
  return useSyncExternalStore(
    subscribePointerCursors,
    getPointerCursorsEnabled,
    getPointerCursorsEnabled,
  );
}

export function resetPointerCursorsForTest() {
  setPointerCursorsEnabled(false);
}
