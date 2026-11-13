import { useSyncExternalStore } from "react";

let enabled = false;
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

export function isWorkspaceFullViewEnabled(): boolean {
  return enabled;
}

export function setWorkspaceFullView(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  publish();
}

export function toggleWorkspaceFullView(): void {
  setWorkspaceFullView(!enabled);
}

export function subscribeWorkspaceFullView(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceFullView(): boolean {
  return useSyncExternalStore(
    subscribeWorkspaceFullView,
    isWorkspaceFullViewEnabled,
    isWorkspaceFullViewEnabled,
  );
}

const DEFAULT_FULL_VIEW_KEY = "lime.workspace.defaultFullView.v1";

export function isWorkspaceFullViewDefaultEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEFAULT_FULL_VIEW_KEY) === "1";
  } catch {
    return false;
  }
}

export function setWorkspaceFullViewDefaultEnabled(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (next) window.localStorage.setItem(DEFAULT_FULL_VIEW_KEY, "1");
    else window.localStorage.removeItem(DEFAULT_FULL_VIEW_KEY);
  } catch {
    // Storage unavailable: keep the in-memory layout state only.
  }
  setWorkspaceFullView(next);
}

export function applyWorkspaceFullViewDefault(): void {
  if (isWorkspaceFullViewDefaultEnabled()) {
    setWorkspaceFullView(true);
  }
}

export function resetWorkspaceFullViewForTest(): void {
  enabled = false;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(DEFAULT_FULL_VIEW_KEY);
    } catch {
      // ignore unavailable storage
    }
  }
  publish();
}
