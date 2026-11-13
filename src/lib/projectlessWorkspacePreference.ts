import { useSyncExternalStore } from "react";

const STORAGE_KEY = "lime.chat.projectless-workspace.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getProjectlessWorkspaceRoot(): string | null {
  return current;
}

export function setProjectlessWorkspaceRoot(path: string | null) {
  current = path?.trim() || null;
  if (typeof window !== "undefined") {
    try {
      if (current) {
        window.localStorage.setItem(STORAGE_KEY, current);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Preference stays in memory.
    }
  }
  publish();
}

export function subscribeProjectlessWorkspaceRoot(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useProjectlessWorkspaceRoot(): string | null {
  return useSyncExternalStore(
    subscribeProjectlessWorkspaceRoot,
    getProjectlessWorkspaceRoot,
    getProjectlessWorkspaceRoot,
  );
}

export function resetProjectlessWorkspaceRootForTest() {
  setProjectlessWorkspaceRoot(null);
}
